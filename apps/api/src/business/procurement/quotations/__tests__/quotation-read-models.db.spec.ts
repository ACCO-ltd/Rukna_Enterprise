import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { activateSodRules } from '../../__tests__/helpers/governance-fixture.js';
import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import {
  cleanupQuotationEnv,
  createApprovedMr,
  createQuotationEnv,
  setAwardBandsActive,
  type QuotationTestEnv,
} from './helpers/quotation-fixture.js';
import { refusal, steps } from './helpers/quotation-steps.js';
import type { QuotationAction } from '../domain/quotation-state.policy.js';

/**
 * ADR-044 Q8 (live DB) — the queues, the detail's allowedActions, money gating (R10) and SLA
 * colouring at read time.
 */
describe('ADR-044 Q8 — quotation read models', () => {
  const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  let env: QuotationTestEnv;
  let svc: QuotationServices;
  let s: ReturnType<typeof steps>;
  let queries = 0;
  const ids: Record<string, string> = {};

  const ids_ = (items: Array<{ id: string }>) => items.map((i) => i.id);
  const withRoles = (identity: RequestIdentity, roles: string[]) => ({ ...identity, roles });

  beforeAll(async () => {
    (prisma as unknown as { $on(e: 'query', cb: () => void): void }).$on('query', () => {
      queries += 1;
    });
    env = await createQuotationEnv(prisma);
    svc = buildQuotationServices(prisma);
    s = steps(prisma, env, svc);
    await activateSodRules(prisma, env.orgId, ['QUOTE_UPLOADER_CANNOT_SELECT', 'REQUESTER_CANNOT_SELECT']);

    const sentAwaiting = async (key: string, sentAt: string, priority: 'NORMAL' | 'URGENT' = 'NORMAL') => {
      const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 1, estimate: 80 }], priority });
      const r = await s.collected(mr.id, ['Hodan']);
      await svc.collect.send(env.as('collector'), r.id);
      await prisma.quotationRequest.update({ where: { id: r.id }, data: { sentAt: new Date(sentAt) } });
      ids[key] = r.id;
      return r;
    };

    // collecting
    ids.collecting = (await s.collected((await createApprovedMr(prisma, env)).id, ['Hodan'])).id;
    // returned
    const returned = await sentAwaiting('returned', '2026-10-08T05:00:00Z');
    await svc.selection.askAnother(env.as('selector'), returned.id, 'one more');
    // awaiting (oldest first by sentAt): Thu 08:00 local and Thu 11:00 local; urgent Thu 12:00 local
    await sentAwaiting('awaitingOld', '2026-10-08T05:00:00Z');
    await sentAwaiting('awaitingNew', '2026-10-08T08:00:00Z');
    await sentAwaiting('awaitingUrgent', '2026-10-08T09:00:00Z', 'URGENT');
    // pending approval on the CD step
    const pending = await sentAwaiting('pending', '2026-10-08T06:00:00Z');
    await svc.selection.enterTotal(env.as('selector'), pending.id, pending.quotes[0].id, '80');
    await setAwardBandsActive(prisma, env, true);
    await refusal(
      svc.awards.award(env.as('selector'), pending.id, { quoteId: pending.quotes[0].id, paymentPath: 'BUYER_CASH', awardSupplierId: env.supplierId }),
    );
    await setAwardBandsActive(prisma, env, false);
    // awarded without / with a live PO
    for (const key of ['awarded', 'ordered']) {
      const r = await sentAwaiting(key, '2026-10-08T05:00:00Z');
      await svc.selection.enterTotal(env.as('selector'), r.id, r.quotes[0].id, '75');
      await svc.awards.award(env.as('selector'), r.id, { quoteId: r.quotes[0].id, paymentPath: 'BUYER_CASH', awardSupplierId: env.supplierId });
    }
    await svc.orders.raiseOrder(env.as('collector'), ids.ordered, {});
    // cancelled
    const cancelled = await s.collected((await createApprovedMr(prisma, env)).id, ['Hodan']);
    await svc.collect.cancel(env.as('collector'), cancelled.id, 'no');
    ids.cancelled = cancelled.id;
  });

  afterAll(async () => {
    svc.query.now = () => new Date();
    await cleanupQuotationEnv(prisma, env);
    await prisma.$disconnect();
  });

  it('each queue returns exactly its states, in queue order', async () => {
    const list = (identity: RequestIdentity, queue: 'collect' | 'returned' | 'waiting' | 'decide' | 'awarded' | 'all', mine?: boolean) =>
      svc.lists.list(identity, { queue, mine });
    expect(ids_((await list(env.as('collector'), 'collect')).items)).toEqual([ids.collecting]);
    expect(ids_((await list(env.as('collector'), 'returned')).items)).toEqual([ids.returned]);
    expect(ids_((await list(env.as('collector'), 'waiting')).items)).toEqual([
      ids.awaitingOld,
      ids.pending,
      ids.awaitingNew,
      ids.awaitingUrgent,
    ]);
    // waiting defaults to my requests; collector2 opened/quoted none of them.
    expect((await list(env.as('collector2'), 'waiting')).items).toEqual([]);
    expect((await list(env.as('collector2'), 'waiting', false)).total).toBe(4);
    // decide: AWAITING_DECISION oldest first; the pending award only for its current step's role.
    expect(ids_((await list(env.as('selector'), 'decide')).items)).toEqual([ids.awaitingOld, ids.awaitingNew, ids.awaitingUrgent]);
    expect(ids_((await list(withRoles(env.as('selector'), ['Construction Director']), 'decide')).items)).toEqual([
      ids.awaitingOld,
      ids.pending,
      ids.awaitingNew,
      ids.awaitingUrgent,
    ]);
    expect(ids_((await list(env.as('collector'), 'awarded')).items)).toEqual([ids.awarded]);
    const all = await list(env.as('selector'), 'all');
    expect(all.total).toBe(Object.keys(ids).length);
    expect(new Set(ids_(all.items))).toEqual(new Set(Object.values(ids)));
  });

  it('rows carry counts, SLA colouring at read time, and paging', async () => {
    svc.query.now = () => new Date('2026-10-08T09:00:00Z'); // Thu 12:00 Mogadishu
    try {
      const { items, total, page, limit } = await svc.lists.list(env.as('selector'), { queue: 'decide', limit: 2 });
      expect({ total, page, limit }).toEqual({ total: 3, page: 1, limit: 2 });
      expect(items[0]).toMatchObject({
        id: ids.awaitingOld,
        waitingWorkingMinutes: 240,
        slaTone: 'red',
        quoteCount: 1,
        distinctSupplierCount: 1,
        requiredQuoteCount: 1,
        urgent: false,
        estimateAmount: '80.00',
        moneyVisible: true,
        mr: { title: 'Cement & rebar' },
        project: { id: env.projectId, code: 'PRJ-001', name: 'Test Site' },
      });
      expect(items[1]).toMatchObject({ id: ids.awaitingNew, waitingWorkingMinutes: 60, slaTone: 'none' });
      const second = await svc.lists.list(env.as('selector'), { queue: 'decide', limit: 2, page: 2 });
      expect(second.items).toHaveLength(1);
      expect(second.items[0]).toMatchObject({ id: ids.awaitingUrgent, urgent: true, waitingWorkingMinutes: 0, slaTone: 'none' });

      svc.query.now = () => new Date('2026-10-08T11:00:00Z'); // Thu 14:00: amber for the 11:00 send
      const later = await svc.lists.list(env.as('selector'), { queue: 'decide' });
      expect(later.items.find((i) => i.id === ids.awaitingNew)).toMatchObject({ waitingWorkingMinutes: 180, slaTone: 'amber' });
      expect(later.items.find((i) => i.id === ids.awaitingUrgent)).toMatchObject({ waitingWorkingMinutes: 120, slaTone: 'amber' });
      // Not waiting → no clock.
      const awarded = await svc.lists.list(env.as('selector'), { queue: 'awarded' });
      expect(awarded.items[0]).toMatchObject({ waitingWorkingMinutes: null, slaTone: 'none', awardedTotal: '75.00' });
    } finally {
      svc.query.now = () => new Date();
    }
  });

  it('search matches the QR number, MR number and project; projectId filters', async () => {
    const target = await svc.query.detail(env.as('collector'), ids.awarded);
    expect(ids_((await svc.lists.list(env.as('collector'), { q: target.number })).items)).toEqual([ids.awarded]);
    expect(ids_((await svc.lists.list(env.as('collector'), { q: target.materialRequest.number.toLowerCase() })).items)).toEqual([
      ids.awarded,
    ]);
    expect((await svc.lists.list(env.as('collector'), { q: 'Test Site' })).total).toBe(Object.keys(ids).length);
    expect((await svc.lists.list(env.as('collector'), { projectId: env.projectId })).total).toBe(Object.keys(ids).length);
  });

  it('R10: a money-blind caller gets null money everywhere; a selector sees it', async () => {
    const pm = env.as('pm');
    const row = (await svc.lists.list(pm, { queue: 'awarded' })).items[0];
    expect(row).toMatchObject({ moneyVisible: false, estimateAmount: null, lowestTotal: null, awardedTotal: null });
    const detail = await svc.query.detail(pm, ids.awarded);
    expect(detail).toMatchObject({ moneyVisible: false, estimateAmount: null, lowestTotal: null });
    expect(detail.award?.total).toBeNull();
    expect(detail.quotes[0]).toMatchObject({ enteredTotal: null, isLowest: null });
    expect(detail.lines[0]).toMatchObject({ estimatedUnitPrice: null, estimatedAmount: null });

    const asSelector = await svc.query.detail(env.as('selector'), ids.awarded);
    expect(asSelector).toMatchObject({ moneyVisible: true, estimateAmount: '80.00', lowestTotal: '75.00' });
    expect(asSelector.quotes[0]).toMatchObject({ enteredTotal: '75.00', isLowest: true });
    expect(asSelector.lines[0]).toMatchObject({ estimatedUnitPrice: '80.0000', estimatedAmount: '80.00' });
    // award:quotation alone (no view:commitment-ledger) also sees money.
    const awardOnly = { ...env.as('selector'), permissions: [PERMISSIONS.procurementView, PERMISSIONS.quotationsAward] };
    expect((await svc.query.detail(awardOnly, ids.awarded)).moneyVisible).toBe(true);
  });

  it('allowedActions agree with the commands: every disabled action is refused with its reason code', async () => {
    const quoteOf = async (id: string) => (await svc.query.detail(env.as('collector'), id)).quotes[0]?.id ?? 'none';
    const run = async (identity: RequestIdentity, id: string, action: QuotationAction) => {
      const quoteId = await quoteOf(id);
      const photo = { platformFileId: 'never-reached', capturedAt: '2026-10-07T07:00:00Z', source: 'CAMERA' as const };
      switch (action) {
        case 'ADD_QUOTE':
          return svc.collect.addQuote(identity, id, { clientRef: randomUUID(), storeName: 'Probe', photos: [photo] });
        case 'ADD_PAGE':
          return svc.collect.addPage(identity, id, quoteId, photo);
        case 'WITHDRAW_QUOTE':
          return svc.collect.withdrawQuote(identity, id, quoteId);
        case 'SEND':
          return svc.collect.send(identity, id, 'URGENT');
        case 'REOPEN':
          return svc.collect.reopen(identity, id, 'probe');
        case 'ENTER_TOTAL':
          return svc.selection.enterTotal(identity, id, quoteId, '10');
        case 'REJECT_QUOTE':
          return svc.selection.rejectQuote(identity, id, quoteId, 'ILLEGIBLE');
        case 'ASK_ANOTHER':
          return svc.selection.askAnother(identity, id, 'probe');
        case 'AWARD':
          return svc.awards.award(identity, id, { quoteId, paymentPath: 'BUYER_CASH' });
        case 'WITHDRAW_AWARD':
          return svc.awards.withdrawAward(identity, id);
        case 'REQUEST_REDECISION':
          return svc.orders.requestRedecision(identity, id, 'probe');
        case 'RAISE_ORDER':
          return svc.orders.raiseOrder(identity, id, {});
        case 'CANCEL':
          return svc.collect.cancel(identity, id, 'probe');
      }
    };
    const callers: RequestIdentity[] = [
      env.as('collector'),
      env.as('selector'),
      env.as('pm'),
      { ...env.as('requester'), permissions: [...env.as('requester').permissions, PERMISSIONS.quotationsAward] },
    ];
    let checked = 0;
    for (const id of Object.values(ids)) {
      for (const caller of callers) {
        const detail = await svc.query.detail(caller, id);
        for (const availability of detail.allowedActions.filter((a) => !a.enabled)) {
          const result = await refusal(run(caller, id, availability.action));
          expect({ action: availability.action, code: result.code }).toEqual({
            action: availability.action,
            code: availability.reasonCode,
          });
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('a list page costs a fixed number of queries, whatever its size', async () => {
    const count = async (limit: number) => {
      queries = 0;
      await svc.lists.list(env.as('selector'), { queue: 'all', limit });
      return queries;
    };
    // Warm-up first: the first list call can pay one-off lookups (cached afterwards), which made
    // the 1-row page count one more query than the 50-row page and failed CI intermittently.
    await count(1);
    const small = await count(1);
    const large = await count(50);
    expect(large).toBe(small);
    expect(small).toBeLessThanOrEqual(8);
    void Prisma;
  });
});
