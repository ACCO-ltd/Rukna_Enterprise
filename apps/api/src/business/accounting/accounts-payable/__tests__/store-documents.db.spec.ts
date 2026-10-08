import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { activateSodRules } from '../../../procurement/__tests__/helpers/governance-fixture.js';
import { createUploadedPhoto } from '../../../procurement/quotations/__tests__/helpers/quotation-fixture.js';
import { refusal } from '../../../procurement/quotations/__tests__/helpers/quotation-steps.js';
import { awardSteps } from './helpers/award-steps.js';
import { buildPaymentServices, type PaymentServices } from './helpers/build-payment-services.js';
import { cleanupPaymentEnv, createPaymentEnv, type PaymentTestEnv } from './helpers/payment-fixture.js';

/**
 * ADR-045 P5 (live DB) — store documents: capture (S4), idempotency, R12, the photo read rule,
 * collector-only upload, reject / withdraw and their notifications.
 */
describe('ADR-045 P5 — store documents', () => {
  const prisma = new PrismaClient();
  let env: PaymentTestEnv;
  let svc: PaymentServices;
  let a: ReturnType<typeof awardSteps>;

  beforeAll(async () => {
    env = await createPaymentEnv(prisma);
    svc = buildPaymentServices(prisma);
    a = awardSteps(prisma, env, svc);
    await activateSodRules(prisma, env.orgId, ['QUOTE_UPLOADER_CANNOT_SELECT', 'REQUESTER_CANNOT_SELECT']);
  });

  afterAll(async () => {
    await cleanupPaymentEnv(prisma, env);
    await prisma.$disconnect();
  });

  const photo = async (persona: 'collector' | 'collector2' | 'pm' = 'collector', content?: string) => {
    const file = await createUploadedPhoto(prisma, env, persona, { content });
    return { platformFileId: file.id, capturedAt: '2026-10-08T10:42:00.000Z', source: 'CAMERA' as const };
  };

  const notificationsOf = (resourceId: string, kind: string) =>
    prisma.notification.findMany({ where: { resourceId, kind: kind as never }, select: { recipientUserId: true, resolvedAt: true } });

  it('S4: the buyer sends a 2-page receipt (no amount) → SUBMITTED, files bound, payers asked to record it', async () => {
    const { poId, requestId } = await a.awardedOrder();
    const doc = await svc.storeDocuments.create(env.as('collector'), {
      clientRef: randomUUID(),
      purchaseOrderId: poId,
      kind: 'RECEIPT',
      photos: [await photo(), await photo()],
    });
    expect(doc).toMatchObject({ status: 'SUBMITTED', kind: 'RECEIPT', quotationRequestId: requestId, photoCount: 2 });
    expect(doc.number).toMatch(/^SD-\d{5}$/);
    const files = await prisma.platformFile.findMany({ where: { id: { in: doc.photos.map((p) => p.fileId) } } });
    expect(files.every((f) => f.lifecycle === 'BOUND')).toBe(true);
    const rows = await notificationsOf(doc.id, 'RECEIPT_TO_RECORD');
    expect(rows.map((r) => r.recipientUserId)).toContain(env.userIds.selector);
    expect(rows.map((r) => r.recipientUserId)).not.toContain(env.userIds.collector);
    const ctx = await prisma.notification.findFirstOrThrow({ where: { resourceId: doc.id, kind: 'RECEIPT_TO_RECORD' } });
    expect(JSON.stringify(ctx.contextData)).not.toMatch(/1000|amount/i);
  });

  it('a replay of the same clientRef returns the same document; other photos under it are refused', async () => {
    const { poId } = await a.awardedOrder();
    const clientRef = randomUUID();
    const p = await photo();
    const first = await svc.storeDocuments.create(env.as('collector'), { clientRef, purchaseOrderId: poId, kind: 'RECEIPT', photos: [p] });
    const again = await svc.storeDocuments.create(env.as('collector'), { clientRef, purchaseOrderId: poId, kind: 'RECEIPT', photos: [p] });
    expect(again.id).toBe(first.id);
    expect(
      await refusal(svc.storeDocuments.create(env.as('collector'), { clientRef, purchaseOrderId: poId, kind: 'RECEIPT', photos: [await photo()] })),
    ).toEqual({ status: 409, code: 'CLIENT_REF_CONFLICT' });
  });

  it('R12: the same receipt photo on another document of the org is refused', async () => {
    const one = await a.awardedOrder();
    const two = await a.awardedOrder();
    const content = `receipt-${randomUUID()}`;
    await svc.storeDocuments.create(env.as('collector'), {
      clientRef: randomUUID(),
      purchaseOrderId: one.poId,
      kind: 'RECEIPT',
      photos: [await photo('collector', content)],
    });
    expect(
      await refusal(
        svc.storeDocuments.create(env.as('collector'), {
          clientRef: randomUUID(),
          purchaseOrderId: two.poId,
          kind: 'RECEIPT',
          photos: [await photo('collector', content)],
        }),
      ),
    ).toEqual({ status: 409, code: 'STORE_DOCUMENT_PHOTO_DUPLICATE' });
  });

  it('only a collector of the award can send its receipt; only for an issued award order', async () => {
    const { poId } = await a.awardedOrder();
    expect(
      await refusal(
        svc.storeDocuments.create(env.as('collector2'), { clientRef: randomUUID(), purchaseOrderId: poId, kind: 'RECEIPT', photos: [await photo('collector2')] }),
      ),
    ).toEqual({ status: 403, code: 'STORE_DOCUMENT_NOT_COLLECTOR' });
    await prisma.purchaseOrder.update({ where: { id: poId }, data: { status: 'CLOSED' } });
    expect(
      await refusal(
        svc.storeDocuments.create(env.as('collector'), { clientRef: randomUUID(), purchaseOrderId: poId, kind: 'RECEIPT', photos: [await photo()] }),
      ),
    ).toEqual({ status: 409, code: 'STORE_DOCUMENT_NOT_AWARD_PO' });
    await prisma.purchaseOrder.update({ where: { id: poId }, data: { status: 'OPEN' } });
  });

  it('a money-blind user cannot read the receipt photo; the list hides photo ids from them', async () => {
    const { poId } = await a.awardedOrder();
    const doc = await svc.storeDocuments.create(env.as('collector'), {
      clientRef: randomUUID(),
      purchaseOrderId: poId,
      kind: 'INVOICE',
      photos: [await photo()],
    });
    const fileId = doc.photos[0].fileId;
    await expect(svc.fileAuth.assertCanRead(env.as('pm'), fileId)).rejects.toMatchObject({ status: 403 });
    await expect(svc.fileAuth.assertCanRead(env.as('selector'), fileId)).resolves.toBeTruthy();
    const [row] = await svc.storeDocuments.list(env.as('pm'), poId);
    expect(row.photos).toEqual([]);
    expect(row.photoCount).toBe(1);
  });

  it('reject resolves the finance ask and tells the uploader; withdraw resolves it too', async () => {
    const { poId } = await a.awardedOrder();
    const doc = await svc.storeDocuments.create(env.as('collector'), { clientRef: randomUUID(), purchaseOrderId: poId, kind: 'RECEIPT', photos: [await photo()] });
    const rejected = await svc.storeDocuments.reject(env.as('selector'), doc.id, 'ILLEGIBLE');
    expect(rejected).toMatchObject({ status: 'REJECTED', rejectReason: 'ILLEGIBLE' });
    expect((await notificationsOf(doc.id, 'RECEIPT_TO_RECORD')).every((r) => r.resolvedAt !== null)).toBe(true);
    expect(await notificationsOf(doc.id, 'RECEIPT_REJECTED')).toEqual([{ recipientUserId: env.userIds.collector, resolvedAt: null }]);
    expect(await refusal(svc.storeDocuments.reject(env.as('selector'), doc.id, 'OTHER', 'x'))).toEqual({
      status: 409,
      code: 'STORE_DOCUMENT_NOT_SUBMITTED',
    });

    const other = await svc.storeDocuments.create(env.as('collector'), { clientRef: randomUUID(), purchaseOrderId: poId, kind: 'RECEIPT', photos: [await photo()] });
    expect(await refusal(svc.storeDocuments.withdraw(env.as('collector2'), other.id))).toEqual({ status: 403, code: 'STORE_DOCUMENT_NOT_UPLOADER' });
    const withdrawn = await svc.storeDocuments.withdraw(env.as('collector'), other.id);
    expect(withdrawn.status).toBe('WITHDRAWN');
    expect((await notificationsOf(other.id, 'RECEIPT_TO_RECORD')).every((r) => r.resolvedAt !== null)).toBe(true);
  });

  it('S1: the award order issued → PAYMENT_NEEDED to the payers (not the request creator), once', async () => {
    const { requestId } = await a.awardedOrder();
    const rows = await notificationsOf(requestId, 'PAYMENT_NEEDED');
    expect(rows.map((r) => r.recipientUserId)).toEqual([env.userIds.selector]);
    expect(rows[0].resolvedAt).toBeNull();
  });
});
