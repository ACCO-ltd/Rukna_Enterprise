import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { buildProcurementServices } from '../../__tests__/helpers/build-procurement-services.js';
import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import {
  cleanupQuotationEnv,
  createApprovedMr,
  createQuotationEnv,
  createUploadedPhoto,
  type QuotationTestEnv,
} from './helpers/quotation-fixture.js';
import { refusal, steps } from './helpers/quotation-steps.js';

/**
 * ADR-044 Q3 (live DB) — open, collect, send, reopen, cancel; the QUOTATION_PHOTO owner kind; the
 * MR-cancel cascade. Scenarios S1–S3, refusals R2, R3, R7, R8.
 */
describe('ADR-044 Q3 — collecting quotations', () => {
  const prisma = new PrismaClient();
  let env: QuotationTestEnv;
  let svc: QuotationServices;
  let s: ReturnType<typeof steps>;

  beforeAll(async () => {
    env = await createQuotationEnv(prisma);
    svc = buildQuotationServices(prisma);
    s = steps(prisma, env, svc);
  });

  afterAll(async () => {
    await cleanupQuotationEnv(prisma, env);
    await prisma.$disconnect();
  });

  describe('open (S1, R7, R8)', () => {
    it('opens once and returns the same request on repeat (201 then 200)', async () => {
      const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 10, estimate: 50 }], priority: 'URGENT' });
      const first = await svc.collect.open(env.as('collector'), mr.id);
      const second = await svc.collect.open(env.as('collector2'), mr.id);
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.request.id).toBe(first.request.id);
      expect(first.request).toMatchObject({
        status: 'COLLECTING',
        urgent: true,
        currencyCode: 'USD',
        estimateAmount: '500.00',
        requiredQuoteCount: 3,
        quoteCount: 0,
        moneyVisible: true,
      });
      expect(first.request.number).toMatch(/^QR-\d{5}$/);
      expect(await s.events(first.request.id)).toEqual(['QUOTATION_OPENED']);
    });

    it('concurrent opens produce exactly one row', async () => {
      const mr = await createApprovedMr(prisma, env);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => svc.collect.open(env.as('collector'), mr.id)),
      );
      expect(new Set(results.map((r) => r.request.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(await prisma.quotationRequest.count({ where: { materialRequestId: mr.id } })).toBe(1);
    });

    it('an unknown estimate (one line unpriced) is null and asks for 3', async () => {
      const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 1, estimate: 10 }, { quantity: 2 }] });
      const { request } = await svc.collect.open(env.as('collector'), mr.id);
      expect(request.estimateAmount).toBeNull();
      expect(request.requiredQuoteCount).toBe(3);
    });

    it('R8: refused on a SUBMITTED MR and on an MR already on a purchase order', async () => {
      const submitted = await createApprovedMr(prisma, env, { status: 'SUBMITTED' });
      expect(await refusal(svc.collect.open(env.as('collector'), submitted.id))).toEqual({
        status: 409,
        code: 'MATERIAL_REQUEST_NOT_APPROVED',
      });

      const ordered = await createApprovedMr(prisma, env, { lines: [{ quantity: 10, estimate: 5 }] });
      const proc = buildProcurementServices(prisma);
      await proc.poService.create(env.identity, {
        supplierId: env.supplierId,
        currencyCode: 'USD',
        effectiveFrom: '2026-10-01',
        lines: [
          {
            lineType: 'MATERIAL',
            materialCode: 'REBAR-12',
            description: 'Rebar',
            uomCode: 'TON',
            orderedQuantity: 4,
            unitPrice: 5,
            spendCategoryId: env.spendCategoryId,
            mrLineAllocations: [{ materialRequestLineId: ordered.lines[0].id, allocatedQuantity: 4 }],
          },
        ],
      });
      expect(await refusal(svc.collect.open(env.as('collector'), ordered.id))).toEqual({
        status: 409,
        code: 'MATERIAL_REQUEST_ALREADY_ORDERED',
      });
    });

    it('a cross-org id is 404', async () => {
      expect((await refusal(svc.query.detail(env.as('collector'), 'qr-does-not-exist'))).status).toBe(404);
      expect((await refusal(svc.collect.send(env.as('collector'), 'qr-does-not-exist'))).status).toBe(404);
      expect((await refusal(svc.collect.open(env.as('collector'), 'mr-does-not-exist'))).status).toBe(404);
    });
  });

  describe('collect (S2)', () => {
    it('a quote names a supplier XOR a new store', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.open(mr.id);
      const photos = [await s.photo('collector')];
      const both = svc.collect.addQuote(env.as('collector'), request.id, {
        clientRef: randomUUID(),
        supplierId: env.supplierId,
        storeName: 'Both',
        photos,
      });
      expect(await refusal(both)).toEqual({ status: 400, code: 'STORE_REQUIRED' });
      const neither = svc.collect.addQuote(env.as('collector'), request.id, { clientRef: randomUUID(), photos });
      expect(await refusal(neither)).toEqual({ status: 400, code: 'STORE_REQUIRED' });
    });

    it('binds photos (BOUND, sha256 copied), pages number in order, store identity normalises', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.open(mr.id);
      let detail = await s.addQuote(request.id, { storeName: '  Hodan   Hardware ' }, { pages: 2 });
      detail = await s.addQuote(request.id, { supplierId: env.supplierId });
      // "test steel co." is the registered supplier's name → it counts as the same store.
      detail = await s.addQuote(request.id, { storeName: 'TEST STEEL CO.' });

      expect(detail.quoteCount).toBe(3);
      expect(detail.distinctSupplierCount).toBe(2);
      const hodan = detail.quotes[0];
      expect(hodan.store).toEqual({ supplierId: null, name: 'Hodan Hardware', registered: false });
      expect(hodan.photos.map((p) => p.pageNumber)).toEqual([1, 2]);
      expect(hodan.enteredTotal).toBeNull();
      expect(detail.supplierMatches).toEqual([
        { quoteId: detail.quotes[2].id, suppliers: [{ id: env.supplierId, code: 'SUP-001', name: 'Test Steel Co.' }] },
      ]);
      const files = await prisma.platformFile.findMany({
        where: { id: { in: hodan.photos.map((p) => p.fileId) } },
        select: { lifecycle: true, checksumSha256: true },
      });
      expect(files.map((f) => f.lifecycle)).toEqual(['BOUND', 'BOUND']);
      expect(files.map((f) => f.checksumSha256).sort()).toEqual(hodan.photos.map((p) => p.sha256).sort());

      // An extra page.
      const page = await s.photo('collector');
      detail = await svc.collect.addPage(env.as('collector'), request.id, hodan.id, page);
      expect(detail.quotes[0].photos.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
      // The same page again is idempotent.
      detail = await svc.collect.addPage(env.as('collector'), request.id, hodan.id, page);
      expect(detail.quotes[0].photos).toHaveLength(3);
    });

    it('a repeated clientRef returns the first quote, no duplicate', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.open(mr.id);
      const clientRef = randomUUID();
      // A true replay: the phone's queue re-sends the same upload (same photo files).
      const photos = [await s.photo('collector')];
      await svc.collect.addQuote(env.as('collector'), request.id, { clientRef, storeName: 'Hodan', photos });
      const replay = await svc.collect.addQuote(env.as('collector'), request.id, { clientRef, storeName: 'Hodan', photos });
      expect(replay.quotes).toHaveLength(1);
      expect(await prisma.quote.count({ where: { quotationRequestId: request.id } })).toBe(1);
    });

    it('R3: the same photo hash on two quotes of one request is refused; on another request it is flagged', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.open(mr.id);
      await s.addQuote(request.id, { storeName: 'Hodan' }, { content: 'same-paper-quote' });
      expect(await refusal(s.addQuote(request.id, { storeName: 'Bakaara' }, { content: 'same-paper-quote' }))).toEqual({
        status: 409,
        code: 'QUOTE_PHOTO_DUPLICATE',
      });

      const otherMr = await createApprovedMr(prisma, env);
      const other = await s.open(otherMr.id);
      const detail = await s.addQuote(other.id, { storeName: 'Xamar' }, { content: 'same-paper-quote' });
      expect(detail.quotes[0].photos[0].reusedOn).toEqual([request.number]);
    });

    it('refuses a photo that is not the caller’s, not finished uploading, or not an image', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.open(mr.id);
      const add = (fileId: string) =>
        svc.collect.addQuote(env.as('collector'), request.id, {
          clientRef: randomUUID(),
          storeName: 'Hodan',
          photos: [{ platformFileId: fileId, capturedAt: '2026-10-07T07:00:00Z', source: 'GALLERY' }],
        });
      const someoneElses = await createUploadedPhoto(prisma, env, 'collector2');
      expect(await refusal(add(someoneElses.id))).toEqual({ status: 403, code: 'FILE_NOT_ATTACHABLE' });
      const pending = await createUploadedPhoto(prisma, env, 'collector', { status: 'PENDING' });
      expect(await refusal(add(pending.id))).toEqual({ status: 409, code: 'FILE_NOT_ATTACHABLE' });
      const pdf = await createUploadedPhoto(prisma, env, 'collector', { mimeType: 'application/pdf' });
      expect(await refusal(add(pdf.id))).toEqual({ status: 400, code: 'FILE_NOT_ATTACHABLE' });
      const huge = await createUploadedPhoto(prisma, env, 'collector', { sizeBytes: 9 * 1024 * 1024 });
      expect(await refusal(add(huge.id))).toEqual({ status: 400, code: 'FILE_NOT_ATTACHABLE' });
      const unsummed = await createUploadedPhoto(prisma, env, 'collector', { checksum: null });
      expect(await refusal(add(unsummed.id))).toEqual({ status: 400, code: 'FILE_NOT_ATTACHABLE' });
      // Nothing was bound by the refused attempts.
      expect(await prisma.quote.count({ where: { quotationRequestId: request.id } })).toBe(0);
    });

    it('withdraw keeps the photos BOUND and drops the quote from the counts', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.open(mr.id);
      const detail = await s.addQuote(request.id, { storeName: 'Hodan' });
      const after = await svc.collect.withdrawQuote(env.as('collector'), request.id, detail.quotes[0].id);
      expect(after.quotes[0].status).toBe('WITHDRAWN');
      expect(after.quoteCount).toBe(0);
      const file = await prisma.platformFile.findUniqueOrThrow({ where: { id: detail.quotes[0].photos[0].fileId } });
      expect(file.lifecycle).toBe('BOUND');
    });
  });

  describe('send, freeze, reopen (S2, S3, R2)', () => {
    it('S3: short of the required stores needs an exception reason', async () => {
      const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 10, estimate: 50 }] }); // $500 → 3
      const request = await s.collected(mr.id, ['Hodan']);
      expect(await refusal(svc.collect.send(env.as('collector'), request.id))).toEqual({
        status: 409,
        code: 'QUOTE_COUNT_EXCEPTION_REQUIRED',
      });
      const sent = await svc.collect.send(env.as('collector'), request.id, 'ONLY_ONE_SUPPLIER');
      expect(sent).toMatchObject({ status: 'AWAITING_DECISION', exceptionReason: 'ONLY_ONE_SUPPLIER', requiredQuoteCount: 3 });
    });

    it('a small estimate (≤ $100) needs one quote and no reason', async () => {
      const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 2, estimate: 50 }] }); // $100.00 → 1
      const request = await s.collected(mr.id, ['Hodan']);
      const sent = await svc.collect.send(env.as('collector'), request.id);
      expect(sent).toMatchObject({ status: 'AWAITING_DECISION', requiredQuoteCount: 1, exceptionReason: null });
    });

    it('S2: send freezes the evidence; R2: adding, paging or withdrawing is then refused; reopen thaws the request', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.collected(mr.id);
      const withdrawn = await s.addQuote(request.id, { storeName: 'Extra' });
      const extra = withdrawn.quotes[3];
      await svc.collect.withdrawQuote(env.as('collector'), request.id, extra.id);

      const sent = await svc.collect.send(env.as('collector'), request.id);
      expect(sent).toMatchObject({ status: 'AWAITING_DECISION', sendCount: 1, quoteCount: 3 });
      expect(sent.sentAt).not.toBeNull();
      expect(sent.firstSentAt).toEqual(sent.sentAt);

      const active = await prisma.platformFile.findMany({
        where: { id: { in: sent.quotes.filter((q) => q.status === 'ACTIVE').flatMap((q) => q.photos.map((p) => p.fileId)) } },
      });
      expect(active.map((f) => f.lifecycle)).toEqual(['IMMUTABLE', 'IMMUTABLE', 'IMMUTABLE']);
      const withdrawnFile = await prisma.platformFile.findUniqueOrThrow({ where: { id: extra.photos[0].fileId } });
      expect(withdrawnFile.lifecycle).toBe('BOUND');

      expect(await refusal(s.addQuote(request.id, { storeName: 'Late' }))).toEqual({ status: 409, code: 'QUOTATION_FROZEN' });
      const page = await s.photo('collector');
      expect(await refusal(svc.collect.addPage(env.as('collector'), request.id, sent.quotes[0].id, page))).toEqual({
        status: 409,
        code: 'QUOTATION_FROZEN',
      });
      expect(await refusal(svc.collect.withdrawQuote(env.as('collector'), request.id, sent.quotes[0].id))).toEqual({
        status: 409,
        code: 'QUOTATION_FROZEN',
      });

      expect((await refusal(svc.collect.reopen(env.as('collector'), request.id, '  '))).status).toBe(400);
      const reopened = await svc.collect.reopen(env.as('collector'), request.id, 'Hodan photo is blurred');
      expect(reopened.status).toBe('COLLECTING');

      // Replacing a photo creates a new quote; the old one is withdrawn, nothing overwritten.
      const hodan = reopened.quotes[0];
      const replaced = await svc.collect.addQuote(env.as('collector'), request.id, {
        clientRef: randomUUID(),
        storeName: 'Hodan Hardware',
        replacesQuoteId: hodan.id,
        photos: [await s.photo('collector')],
      });
      const fresh = replaced.quotes.find((q) => q.replacesQuoteId === hodan.id)!;
      expect(replaced.quotes.find((q) => q.id === hodan.id)!.status).toBe('WITHDRAWN');
      expect(fresh.status).toBe('ACTIVE');

      const resent = await svc.collect.send(env.as('collector'), request.id);
      expect(resent.sendCount).toBe(2);

      const reopenAudit = await prisma.auditLog.findFirst({
        where: { resourceId: request.id, sourceCommand: 'quotation.reopen' },
      });
      expect(reopenAudit?.reason).toBe('Hodan photo is blurred');
      expect(await s.events(request.id)).toEqual([
        'QUOTATION_OPENED',
        'QUOTE_ADDED',
        'QUOTE_ADDED',
        'QUOTE_ADDED',
        'QUOTE_ADDED',
        'QUOTE_WITHDRAWN',
        'QUOTATION_SENT',
        'QUOTATION_REOPENED',
        'QUOTE_WITHDRAWN',
        'QUOTE_ADDED',
        'QUOTATION_SENT',
      ]);
    });

    it('sending with no quote is refused', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.open(mr.id);
      expect(await refusal(svc.collect.send(env.as('collector'), request.id))).toEqual({ status: 409, code: 'QUOTES_REQUIRED' });
    });

    it('a selector cannot run collector commands (permission)', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.open(mr.id);
      expect(await refusal(svc.collect.send(env.as('selector'), request.id))).toEqual({
        status: 403,
        code: 'MISSING_PERMISSION',
      });
    });
  });

  describe('cancel', () => {
    it('cancels with a reason; a new request can then be opened on the MR', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.collected(mr.id, ['Hodan']);
      const cancelled = await svc.collect.cancel(env.as('selector'), request.id, 'Not needed any more');
      expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Not needed any more' });
      expect(cancelled.cancelledBy?.id).toBe(env.userIds.selector);
      expect(await refusal(svc.collect.cancel(env.as('collector'), request.id, 'again'))).toEqual({
        status: 409,
        code: 'QUOTATION_CANCELLED',
      });
      const reopened = await svc.collect.open(env.as('collector'), mr.id);
      expect(reopened.created).toBe(true);
      expect(reopened.request.id).not.toBe(request.id);
    });

    it('MR cancel cascades to its live request', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.collected(mr.id, ['Hodan']);
      await svc.mrService.cancel(env.as('requester'), mr.id);
      const after = await prisma.quotationRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(after).toMatchObject({ status: 'CANCELLED', cancelReason: 'Material request cancelled' });
      expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id: mr.id } })).status).toBe('CANCELLED');
    });

    it('MR cancel is refused while an award has a live purchase order', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.collected(mr.id, ['Hodan']);
      const po = await prisma.purchaseOrder.create({
        data: {
          organizationId: env.orgId,
          supplierId: env.supplierId,
          poNumber: `PO-Q${Date.now().toString(36)}`,
          status: 'DRAFT',
          createdBy: env.userIds.collector,
        },
      });
      await prisma.quotationRequest.update({
        where: { id: request.id },
        data: { status: 'AWARDED', purchaseOrderId: po.id, awardedTotal: new Decimal(10) },
      });
      expect(await refusal(svc.mrService.cancel(env.as('requester'), mr.id))).toEqual({
        status: 409,
        code: 'PURCHASE_ORDER_LIVE',
      });
      expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id: mr.id } })).status).toBe('APPROVED');
    });

    it('the MR detail carries the live request summary', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.collected(mr.id, ['Hodan', 'Bakaara']);
      const detail = await svc.mrService.findById(env.as('collector'), mr.id);
      expect(detail.quotation).toEqual({
        id: request.id,
        number: request.number,
        status: 'COLLECTING',
        quoteCount: 2,
        distinctSupplierCount: 2,
        requiredQuoteCount: 3,
      });
    });
  });

  describe('QUOTATION_PHOTO file access (R10 photos)', () => {
    it('collectors, selectors and cost-visibility holders read; view:procurement alone does not', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.collected(mr.id, ['Hodan']);
      const fileId = request.quotes[0].photos[0].fileId;
      for (const persona of ['collector', 'collector2', 'selector', 'cfo', 'director'] as const) {
        await expect(svc.fileAuth.assertCanRead(env.as(persona), fileId)).resolves.toBeTruthy();
      }
      expect((await refusal(svc.fileAuth.assertCanRead(env.as('pm'), fileId))).status).toBe(403);
      expect((await refusal(svc.fileAuth.assertCanRead(env.as('requester'), fileId))).status).toBe(403);
      // A bound quote photo cannot be deleted or rewritten through the file API.
      expect((await refusal(svc.fileAuth.assertCanDelete(env.as('collector'), fileId))).status).toBe(403);
    });
  });
});
