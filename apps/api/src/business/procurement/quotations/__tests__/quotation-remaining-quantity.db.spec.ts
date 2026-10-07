import { PrismaClient } from '@prisma/client';

import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import {
  cleanupQuotationEnv,
  createApprovedMr,
  createQuotationEnv,
  type QuotationTestEnv,
} from './helpers/quotation-fixture.js';
import { refusal, steps } from './helpers/quotation-steps.js';

/**
 * Review M1 — an MR covered by a quotation round never takes manual PO allocations. Quantity the
 * award's order left out (dropped lines, lower quantities) is ordered only through a NEW round,
 * which may open once the previous round is closed (its order confirmed). One live round per MR.
 */
describe('remaining quantity goes through a new round (review M1)', () => {
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

  const manualPo = (mrLineId: string, qty = 1) =>
    svc.poService.create(env.as('collector'), {
      supplierId: env.supplierId,
      currencyCode: 'USD',
      effectiveFrom: '2026-10-01',
      lines: [
        {
          lineType: 'MATERIAL',
          materialCode: 'REBAR-12',
          description: 'Rebar',
          uomCode: 'TON',
          orderedQuantity: qty,
          unitPrice: 1,
          spendCategoryId: env.spendCategoryId,
          mrLineAllocations: [{ materialRequestLineId: mrLineId, allocatedQuantity: qty }],
        },
      ],
    });

  /** An awarded round on a two-line MR ($1 + $1 per unit, 10 each). */
  async function awardedRound(mrId: string) {
    const request = await s.collected(mrId, ['Hodan']);
    await svc.collect.send(env.as('collector'), request.id);
    await svc.selection.enterTotal(env.as('selector'), request.id, request.quotes[0].id, '20');
    await svc.awards.award(env.as('selector'), request.id, {
      quoteId: request.quotes[0].id,
      paymentPath: 'BUYER_CASH',
      awardSupplierId: env.supplierId,
    });
    return request;
  }

  it('dropped quantity cannot be ordered manually; after the order is confirmed a new round covers it', async () => {
    const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 10, estimate: 1 }, { quantity: 10, estimate: 1 }] });
    const [l1, l2] = mr.lines;
    const first = await awardedRound(mr.id);
    const { purchaseOrderId } = await svc.orders.raiseOrder(env.as('collector'), first.id, {
      lines: [{ materialRequestLineId: l1.id, quantity: '10', amount: '10' }],
    });

    // The award's order is still a draft: the round is live.
    const live = await refusal(manualPo(l2.id));
    expect(live).toEqual({ status: 409, code: 'QUOTATION_IN_PROGRESS' });

    await svc.poService.confirm(env.as('collector'), purchaseOrderId);
    expect((await prisma.quotationRequest.findUniqueOrThrow({ where: { id: first.id } })).closedAt).not.toBeNull();

    // Closed round: still no manual order for the rest — a new round is the way.
    expect(await refusal(manualPo(l2.id))).toEqual({ status: 409, code: 'QUOTATION_ROUND_REQUIRED' });
    const second = await svc.collect.open(env.as('collector'), mr.id);
    expect(second.created).toBe(true);
    expect(second.request.id).not.toBe(first.id);
    // The new round's estimate covers only what is left (line 2: 10 × $1).
    expect(second.request.estimateAmount).toBe('10.00');

    const draft = await s.collected(mr.id, ['Bakaara']);
    await svc.collect.send(env.as('collector'), draft.id);
    await svc.selection.enterTotal(env.as('selector'), draft.id, draft.quotes[0].id, '9.50');
    await svc.awards.award(env.as('selector'), draft.id, {
      quoteId: draft.quotes[0].id,
      paymentPath: 'BUYER_CASH',
      awardSupplierId: env.supplierId,
    });
    const orderDraft = await svc.orders.orderDraft(env.as('collector'), draft.id);
    expect(orderDraft.lines.map((l) => [l.materialRequestLineId, l.quantity])).toEqual([[l2.id, '10.0000']]);
    const raised = await svc.orders.raiseOrder(env.as('collector'), draft.id, {});
    expect(raised.purchaseOrderId).toBeTruthy();
  });

  it('a fully ordered MR cannot open another round; one live round per MR still holds', async () => {
    const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 5, estimate: 1 }] });
    const first = await awardedRound(mr.id);
    const { purchaseOrderId } = await svc.orders.raiseOrder(env.as('collector'), first.id, {});
    await svc.poService.confirm(env.as('collector'), purchaseOrderId);
    expect(await refusal(svc.collect.open(env.as('collector'), mr.id))).toEqual({
      status: 409,
      code: 'MATERIAL_REQUEST_ALREADY_ORDERED',
    });

    const other = await createApprovedMr(prisma, env);
    const live = await s.open(other.id);
    const duplicate = prisma.quotationRequest.create({
      data: { organizationId: env.orgId, number: `QR-DUP-${other.id.slice(-6)}`, materialRequestId: other.id, currencyCode: 'USD', createdBy: env.userIds.collector },
    });
    await expect(duplicate).rejects.toMatchObject({ code: 'P2002' });
    expect(live.status).toBe('COLLECTING');
  });
});
