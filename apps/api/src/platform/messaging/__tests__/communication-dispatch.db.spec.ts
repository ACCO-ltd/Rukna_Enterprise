/**
 * WB — ADR-044 phase 2 background sends (queue + dispatcher), against the tenant DB. The platform
 * route table is faked (route writes are best-effort and covered by WA-01).
 *
 *   WB-01  enqueueMany is idempotent per (org, key) and never aborts the caller's transaction
 *   WB-02  dispatchDue sends due QUEUED background rows (body + URL button), marks SENT, settles the
 *          schedule; client rows (no nextAttemptAt) and future rows are never picked up
 *   WB-03  transient refusal → stays QUEUED with back-off, FAILED after the max attempts;
 *          permanent refusal → FAILED at once; no answer → UNKNOWN, never retried
 *   WB-04  a feature guard withdraws a row (FAILED NOT_NEEDED); a stale row EXPIRES; a claimed row is
 *          leased (a second dispatcher at the same instant does not send it again)
 *   WB-05  webhook status updates apply to background rows
 */
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { tenancyStorage } from '../../tenancy/tenancy.context';
import { TransactionalAuditOutboxService } from '../../audit-logs/application/transactional-audit-outbox.service';
import {
  BACKGROUND_MAX_ATTEMPTS,
  BACKGROUND_MAX_AGE_MS,
  CommunicationService,
} from '../communication.service';
import { OutboundMessageRepository, type NewBackgroundMessage } from '../infrastructure/outbound-message.repository';
import { WhatsAppSendError } from '../whatsapp/whatsapp.client';

const prisma = new PrismaClient();
const repo = new OutboundMessageRepository();
const routes = { record: jest.fn().mockResolvedValue(undefined) };
const whatsapp = { uploadMedia: jest.fn(), sendTemplate: jest.fn(), isConfigured: () => true };
const service = new CommunicationService(
  { getClient: () => prisma } as never,
  repo,
  routes as never,
  whatsapp as never,
  new TransactionalAuditOutboxService(),
);
const run = <T>(fn: () => Promise<T>) =>
  tenancyStorage.run({ tenantId: 'tenant-wb', tenantSlug: 'wb', client: prisma } as never, fn);

let orgId = '';
let userId = '';
const RESOURCE = `wb_resource_${randomUUID().slice(0, 6)}`;

const alert = (over: Partial<NewBackgroundMessage> = {}): NewBackgroundMessage => ({
  organizationId: orgId,
  purpose: 'QUOTE_READY',
  recipient: '+252612345678',
  recipientUserId: userId,
  resourceType: RESOURCE,
  resourceId: 'qr-1',
  templateName: 'quote_ready_so',
  templateLanguage: 'en',
  templateParams: { body: ['QR-00001', 'MR-00001', 'Site', '3'], buttonUrlSuffix: 'qr-1' },
  idempotencyKey: `wb-${randomUUID()}`,
  createdBy: userId,
  ...over,
});

const byKey = (key: string) =>
  prisma.outboundMessage.findUniqueOrThrow({
    where: { organizationId_idempotencyKey: { organizationId: orgId, idempotencyKey: key } },
  });

/** Leaves the table with only this test's rows due (other specs may share the DB). */
async function settleOthers() {
  await prisma.outboundMessage.updateMany({
    where: { organizationId: { not: orgId }, status: 'QUEUED', nextAttemptAt: { not: null } },
    data: { nextAttemptAt: new Date('2999-01-01') },
  });
  await prisma.outboundMessage.updateMany({
    where: { organizationId: orgId, nextAttemptAt: { not: null } },
    data: { nextAttemptAt: null },
  });
}

beforeAll(async () => {
  for (const level of ['log', 'warn', 'error'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  }
  const suffix = `wb${randomUUID().slice(0, 12)}`;
  orgId = `test-org-${suffix}`;
  await prisma.organization.create({ data: { id: orgId, name: `WB ${suffix}`, slug: `test-${suffix}`, status: 'ACTIVE' } });
  const user = await prisma.user.create({
    data: { email: `wb-${suffix}@wb.test`, passwordHash: 'x', firstName: 'Fadumo', lastName: 'Ali', organizationId: orgId },
  });
  userId = user.id;
});

beforeEach(async () => {
  whatsapp.sendTemplate.mockReset().mockImplementation(async () => ({ providerMessageId: `wamid.wb.${randomUUID()}` }));
  routes.record.mockClear();
  await settleOthers();
});

afterAll(async () => {
  await prisma.outboundMessage.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${orgId}`;
  await prisma.$disconnect();
});

describe('WB-01 enqueue', () => {
  it('queues once per key, even repeated inside one transaction, without aborting it', async () => {
    const a = alert();
    const now = new Date();
    const counts = await prisma.$transaction(async (tx) => {
      const first = await repo.enqueueMany(tx, [a], now);
      const again = await repo.enqueueMany(tx, [a, { ...a }], now);
      // The transaction is still usable after the duplicate.
      await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
      return [first, again];
    });
    expect(counts).toEqual([1, 0]);
    const row = await byKey(a.idempotencyKey);
    expect(row).toMatchObject({
      status: 'QUEUED',
      channel: 'WHATSAPP',
      recipientUserId: userId,
      attemptCount: 0,
      templateParams: a.templateParams,
    });
    expect(row.nextAttemptAt?.getTime()).toBe(now.getTime());
  });
});

describe('WB-02 dispatch', () => {
  it('sends due background rows with body + button, marks SENT, ignores client and future rows', async () => {
    const now = new Date();
    const due = alert();
    const future = alert();
    await repo.enqueueMany(prisma, [due], now);
    await repo.enqueueMany(prisma, [future], new Date(now.getTime() + 60_000));
    const client = await prisma.outboundMessage.create({
      data: {
        organizationId: orgId,
        channel: 'WHATSAPP',
        purpose: 'INVOICE',
        recipient: '+252612345678',
        resourceType: 'client_invoice',
        resourceId: 'inv-x',
        idempotencyKey: `wb-client-${randomUUID()}`,
        createdBy: userId,
        status: 'QUEUED', // stuck mid synchronous send: must never be auto-sent
      },
    });

    const summary = await run(() => service.dispatchDue(now));
    expect(summary).toEqual({ sent: 1, retrying: 0, failed: 0, unknown: 0, cancelled: 0 });
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendTemplate).toHaveBeenCalledWith({
      to: '+252612345678',
      templateName: 'quote_ready_so',
      language: 'en',
      bodyParams: ['QR-00001', 'MR-00001', 'Site', '3'],
      buttonUrlSuffix: 'qr-1',
    });
    const sent = await byKey(due.idempotencyKey);
    expect(sent).toMatchObject({ status: 'SENT', attemptCount: 1, nextAttemptAt: null, errorCode: null });
    expect(sent.providerMessageId).toMatch(/^wamid\.wb\./);
    expect(routes.record).toHaveBeenCalledWith(sent.providerMessageId, 'tenant-wb');
    expect((await byKey(future.idempotencyKey)).status).toBe('QUEUED');
    expect((await prisma.outboundMessage.findUniqueOrThrow({ where: { id: client.id } })).status).toBe('QUEUED');
  });
});

describe('WB-03 failures', () => {
  it('a transient refusal backs off and stays QUEUED, then FAILS after the max attempts', async () => {
    whatsapp.sendTemplate.mockRejectedValue(new WhatsAppSendError('RATE_LIMITED', 'slow down'));
    const a = alert();
    let now = new Date();
    await repo.enqueueMany(prisma, [a], now);

    expect((await run(() => service.dispatchDue(now))).retrying).toBe(1);
    let row = await byKey(a.idempotencyKey);
    expect(row).toMatchObject({ status: 'QUEUED', attemptCount: 1, errorCode: 'RATE_LIMITED' });
    expect(row.nextAttemptAt!.getTime()).toBe(now.getTime() + 60_000);
    // Not due yet → nothing happens.
    expect((await run(() => service.dispatchDue(new Date(now.getTime() + 30_000)))).retrying).toBe(0);

    for (let attempt = 2; attempt <= BACKGROUND_MAX_ATTEMPTS; attempt++) {
      now = row.nextAttemptAt!;
      await run(() => service.dispatchDue(now));
      row = await byKey(a.idempotencyKey);
    }
    expect(row).toMatchObject({ status: 'FAILED', attemptCount: BACKGROUND_MAX_ATTEMPTS, errorCode: 'RATE_LIMITED', nextAttemptAt: null });
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(BACKGROUND_MAX_ATTEMPTS);
  });

  it('a permanent refusal fails at once; an unanswered send becomes UNKNOWN and is never retried', async () => {
    const bad = alert();
    const lost = alert();
    const now = new Date();
    await repo.enqueueMany(prisma, [bad], now);
    whatsapp.sendTemplate.mockRejectedValueOnce(new WhatsAppSendError('INVALID_RECIPIENT', 'not on WhatsApp'));
    await run(() => service.dispatchDue(now));
    expect(await byKey(bad.idempotencyKey)).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_RECIPIENT', nextAttemptAt: null });

    await repo.enqueueMany(prisma, [lost], now);
    whatsapp.sendTemplate.mockRejectedValueOnce(new WhatsAppSendError('NETWORK', 'timeout', undefined, true));
    expect((await run(() => service.dispatchDue(now))).unknown).toBe(1);
    expect(await byKey(lost.idempotencyKey)).toMatchObject({ status: 'UNKNOWN', nextAttemptAt: null });
    await run(() => service.dispatchDue(new Date(now.getTime() + 3_600_000)));
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(2);
  });
});

describe('WB-04 guard, expiry, lease', () => {
  it('the owning feature can withdraw a row; a stale row expires; a claimed row is leased', async () => {
    const guard = jest.fn(async (_db: unknown, m: { resourceId: string }) =>
      m.resourceId === 'decided' ? 'Not sent: already decided.' : null,
    );
    service.registerDispatchGuard(RESOURCE, guard as never);
    expect(() => service.registerDispatchGuard(RESOURCE, guard as never)).toThrow();

    const now = new Date();
    const withdrawn = alert({ resourceId: 'decided' });
    const stale = alert();
    await repo.enqueueMany(prisma, [withdrawn], now);
    await repo.enqueueMany(prisma, [stale], new Date(now.getTime() - BACKGROUND_MAX_AGE_MS - 1));
    const summary = await run(() => service.dispatchDue(now));
    expect(summary).toMatchObject({ cancelled: 1, failed: 1, sent: 0 });
    expect(await byKey(withdrawn.idempotencyKey)).toMatchObject({ status: 'FAILED', errorCode: 'NOT_NEEDED', errorMessage: 'Not sent: already decided.' });
    expect(await byKey(stale.idempotencyKey)).toMatchObject({ status: 'FAILED', errorCode: 'EXPIRED' });
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();

    // Lease: claim without finishing (as a crashed process would), then a second dispatcher.
    const leased = alert();
    await repo.enqueueMany(prisma, [leased], now);
    const claimed = await repo.claimDue(prisma, now, new Date(now.getTime() + 300_000), 10);
    expect(claimed.map((r) => r.idempotencyKey)).toContain(leased.idempotencyKey);
    expect((await run(() => service.dispatchDue(now))).sent).toBe(0);
    // After the lease the row is retried.
    expect((await run(() => service.dispatchDue(new Date(now.getTime() + 300_001)))).sent).toBe(1);
    expect(await byKey(leased.idempotencyKey)).toMatchObject({ status: 'SENT', attemptCount: 2 });
  });
});

describe('WB-05 webhook status', () => {
  it('delivered / read updates apply to a background row', async () => {
    const a = alert();
    const now = new Date();
    await repo.enqueueMany(prisma, [a], now);
    await run(() => service.dispatchDue(now));
    const sent = await byKey(a.idempotencyKey);
    const at = Math.floor(Date.now() / 1000);
    await expect(
      service.applyStatusUpdate({ providerMessageId: sent.providerMessageId!, status: 'delivered', timestamp: String(at) }),
    ).resolves.toBe('applied');
    expect(await byKey(a.idempotencyKey)).toMatchObject({ status: 'DELIVERED' });
  });
});

describe('WB-06 review M1/L2 — claim per send, attempt cap, post-accept failure', () => {
  it('claims each row only right before sending it (a slow send does not eat the next lease)', async () => {
    const first = alert();
    const second = alert();
    const now = new Date();
    await repo.enqueueMany(prisma, [first], new Date(now.getTime() - 2000));
    await repo.enqueueMany(prisma, [second], new Date(now.getTime() - 1000));
    const seenWhileFirstSending: Array<{ attemptCount: number }> = [];
    whatsapp.sendTemplate.mockImplementationOnce(async () => {
      seenWhileFirstSending.push(await byKey(second.idempotencyKey));
      return { providerMessageId: `wamid.wb.${randomUUID()}` };
    });
    expect((await run(() => service.dispatchDue())).sent).toBe(2);
    expect(seenWhileFirstSending[0]).toMatchObject({ attemptCount: 0, status: 'QUEUED' });
  });

  it('a row that already used its attempts (e.g. crashes after claim) fails without another send', async () => {
    const a = alert();
    const now = new Date();
    await repo.enqueueMany(prisma, [a], now);
    await prisma.outboundMessage.updateMany({
      where: { organizationId: orgId, idempotencyKey: a.idempotencyKey },
      data: { attemptCount: BACKGROUND_MAX_ATTEMPTS, errorCode: 'NETWORK', errorMessage: 'Could not reach WhatsApp.' },
    });
    expect((await run(() => service.dispatchDue(now))).failed).toBe(1);
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(await byKey(a.idempotencyKey)).toMatchObject({ status: 'FAILED', errorCode: 'NETWORK', nextAttemptAt: null });
  });

  it('if recording the accepted send fails, the row is settled UNKNOWN and never re-sent', async () => {
    const a = alert();
    const now = new Date();
    await repo.enqueueMany(prisma, [a], now);
    const spy = jest.spyOn(repo, 'markSent').mockRejectedValueOnce(new Error('db hiccup'));
    try {
      await run(() => service.dispatchDue(now));
    } finally {
      spy.mockRestore();
    }
    expect(await byKey(a.idempotencyKey)).toMatchObject({ status: 'UNKNOWN', nextAttemptAt: null });
    await run(() => service.dispatchDue(new Date(now.getTime() + 600_000)));
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
  });
});
