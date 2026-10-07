import { PrismaClient } from '@prisma/client';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { NotificationsService } from '../../../../platform/notifications/application/notifications.service.js';
import { NotificationPrismaRepository } from '../../../../platform/notifications/infrastructure/notification-prisma.repository.js';
import { activateSodRules } from '../../__tests__/helpers/governance-fixture.js';
import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import {
  cleanupQuotationEnv,
  createApprovedMr,
  createQuotationEnv,
  setAwardBandsActive,
  type QuotationTestEnv,
} from './helpers/quotation-fixture.js';
import { steps } from './helpers/quotation-steps.js';

/**
 * ADR-044 Q7 (live DB) — event-driven quotation notifications, written in the command's
 * transaction (NotificationWriter), not gated by the daily generator's flag.
 */
describe('ADR-044 Q7 — quotation notifications', () => {
  const prisma = new PrismaClient();
  let env: QuotationTestEnv;
  let svc: QuotationServices;
  let s: ReturnType<typeof steps>;
  let feed: NotificationsService;

  const rows = (requestId: string, kind?: string) =>
    prisma.notification.findMany({
      where: { resourceType: 'QuotationRequest', resourceId: requestId, ...(kind ? { kind: kind as never } : {}) },
      orderBy: [{ kind: 'asc' }, { recipientUserId: 'asc' }, { createdAt: 'asc' }],
    });
  const open = async (requestId: string, kind: string) =>
    (await rows(requestId, kind)).filter((r) => r.resolvedAt === null);

  beforeAll(async () => {
    env = await createQuotationEnv(prisma);
    svc = buildQuotationServices(prisma);
    s = steps(prisma, env, svc);
    await activateSodRules(prisma, env.orgId, ['QUOTE_UPLOADER_CANNOT_SELECT', 'REQUESTER_CANNOT_SELECT']);
    // The MR requester also holds award:quotation — SoD bars them, so they must not be pinged.
    const award = await prisma.permission.findUniqueOrThrow({
      where: { action_resource: { action: 'award', resource: 'quotation' } },
    });
    const requesterRole = await prisma.role.findFirstOrThrow({ where: { organizationId: env.orgId, name: 'requester-role' } });
    await prisma.rolePermission.create({ data: { roleId: requesterRole.id, permissionId: award.id } });
    feed = new NotificationsService(
      new NotificationPrismaRepository({ getClient: () => prisma } as unknown as TenancyService),
    );
  });

  afterAll(async () => {
    await cleanupQuotationEnv(prisma, env);
    await prisma.$disconnect();
  });

  it('send → one QUOTES_READY per eligible selector (SoD-barred excluded), no money, deep link to finance', async () => {
    expect(process.env.NOTIFICATIONS_GENERATION_ENABLED).not.toBe('true');
    const mr = await createApprovedMr(prisma, env);
    const request = await s.collected(mr.id);
    await svc.collect.send(env.as('collector'), request.id);

    const ready = await rows(request.id, 'QUOTES_READY');
    expect(ready.map((r) => r.recipientUserId).sort()).toEqual(
      [env.userIds.selector, env.userIds.selector2, env.userIds.cfo].sort(),
    );
    for (const row of ready) {
      expect(row).toMatchObject({
        severity: 'WARNING',
        dedupeKey: `quotation:${request.id}:QUOTES_READY:1`,
        actionUrl: `/finance/quotes/${request.id}`,
        projectId: env.projectId,
        resolvedAt: null,
        readAt: null,
      });
      expect(row.contextData).toEqual({ number: request.number, mrNumber: mr.mrNumber, projectName: 'Test Site', quoteCount: 3 });
    }
    // It reaches the bell (the feed reads unresolved rows) with the generator flag off.
    const bell = await feed.list(env.orgId, env.userIds.selector, { unread: true });
    expect(bell.items.map((i) => i.resourceId)).toContain(request.id);
    expect(bell.unreadTotal).toBeGreaterThanOrEqual(1);
  });

  it('S6 cycle: ask-another resolves QUOTES_READY and pings the collectors; the next send opens a new cycle', async () => {
    const mr = await createApprovedMr(prisma, env);
    const request = await s.collected(mr.id, ['Hodan']);
    await s.addQuote(request.id, { storeName: 'Bakaara' }, { persona: 'collector2' });
    await svc.collect.send(env.as('collector'), request.id, 'URGENT');
    await svc.selection.askAnother(env.as('selector'), request.id, 'Check Xamar Steel too');

    expect(await open(request.id, 'QUOTES_READY')).toHaveLength(0);
    const another = await rows(request.id, 'ANOTHER_QUOTE_REQUESTED');
    expect(another.map((r) => r.recipientUserId).sort()).toEqual([env.userIds.collector, env.userIds.collector2].sort());
    expect(another[0]).toMatchObject({ actionUrl: `/procurement/quotes/${request.id}`, severity: 'WARNING' });
    expect(another[0].contextData).toMatchObject({ note: 'Check Xamar Steel too', quoteCount: 2 });

    await s.addQuote(request.id, { storeName: 'Xamar' });
    await svc.collect.send(env.as('collector'), request.id);
    expect(await open(request.id, 'ANOTHER_QUOTE_REQUESTED')).toHaveLength(0);
    const cycle2 = await open(request.id, 'QUOTES_READY');
    expect(new Set(cycle2.map((r) => r.dedupeKey))).toEqual(new Set([`quotation:${request.id}:QUOTES_READY:2`]));
    expect(cycle2).toHaveLength(3);
    // Cycle 1's rows are still there, resolved.
    expect((await rows(request.id, 'QUOTES_READY')).filter((r) => r.resolvedAt !== null)).toHaveLength(3);
  });

  it('award resolves QUOTES_READY and announces QUOTATION_AWARDED; raising the order resolves it', async () => {
    const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 1, estimate: 90 }] });
    const request = await s.collected(mr.id, ['Hodan']);
    await svc.collect.send(env.as('collector'), request.id);
    await svc.selection.enterTotal(env.as('selector'), request.id, request.quotes[0].id, '90');
    await svc.awards.award(env.as('selector'), request.id, {
      quoteId: request.quotes[0].id,
      paymentPath: 'BUYER_CASH',
      awardSupplierId: env.supplierId,
    });
    expect(await open(request.id, 'QUOTES_READY')).toHaveLength(0);
    const awarded = await open(request.id, 'QUOTATION_AWARDED');
    expect(awarded.map((r) => r.recipientUserId)).toEqual([env.userIds.collector]);
    expect(awarded[0]).toMatchObject({ severity: 'INFO', actionUrl: `/procurement/quotes/${request.id}` });
    expect(Object.keys(awarded[0].contextData as object).sort()).toEqual(['mrNumber', 'number', 'projectName', 'quoteCount']);

    await svc.orders.raiseOrder(env.as('collector'), request.id, {});
    expect(await open(request.id, 'QUOTATION_AWARDED')).toHaveLength(0);
  });

  it('a pending award withdrawn re-arms the same QUOTES_READY row without resurrecting readAt', async () => {
    await setAwardBandsActive(prisma, env, true);
    try {
      const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 1, estimate: 80 }] });
      const request = await s.collected(mr.id, ['Hodan']);
      await svc.collect.send(env.as('collector'), request.id);
      const mine = (await rows(request.id, 'QUOTES_READY')).find((r) => r.recipientUserId === env.userIds.selector)!;
      await feed.markRead(env.orgId, env.userIds.selector, mine.id);
      await svc.selection.enterTotal(env.as('selector'), request.id, request.quotes[0].id, '80');
      await expect(
        svc.awards.award(env.as('selector'), request.id, {
          quoteId: request.quotes[0].id,
          paymentPath: 'BUYER_CASH',
          awardSupplierId: env.supplierId,
        }),
      ).rejects.toBeTruthy();
      expect(await open(request.id, 'QUOTES_READY')).toHaveLength(0);

      await svc.awards.withdrawAward(env.as('selector'), request.id);
      const rearmed = await prisma.notification.findUniqueOrThrow({ where: { id: mine.id } });
      expect(rearmed.resolvedAt).toBeNull();
      expect(rearmed.readAt).not.toBeNull();
      expect(await open(request.id, 'QUOTES_READY')).toHaveLength(3);
    } finally {
      await setAwardBandsActive(prisma, env, false);
    }
  });

  it('cancel resolves everything open on the request', async () => {
    const mr = await createApprovedMr(prisma, env);
    const request = await s.collected(mr.id);
    await svc.collect.send(env.as('collector'), request.id);
    await svc.collect.cancel(env.as('collector'), request.id, 'Not needed');
    expect((await rows(request.id)).every((r) => r.resolvedAt !== null)).toBe(true);
  });

  it('a rolled-back command leaves no notification', async () => {
    const mr = await createApprovedMr(prisma, env);
    const request = await s.collected(mr.id);
    const original = svc.notifier.sent.bind(svc.notifier);
    svc.notifier.sent = async (...args) => {
      await original(...args);
      throw new Error('boom after notifying');
    };
    try {
      await expect(svc.collect.send(env.as('collector'), request.id)).rejects.toThrow('boom after notifying');
    } finally {
      svc.notifier.sent = original;
    }
    expect(await rows(request.id)).toHaveLength(0);
    expect((await prisma.quotationRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('COLLECTING');
  });
});
