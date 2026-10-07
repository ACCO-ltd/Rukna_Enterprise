import { PrismaClient } from '@prisma/client';

import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import {
  cleanupQuotationEnv,
  createApprovedMr,
  createQuotationEnv,
  type QuotationTestEnv,
} from './helpers/quotation-fixture.js';
import { steps } from './helpers/quotation-steps.js';

/**
 * No manual PO bypass of a live quotation round: creating or revising a PO with an allocation to
 * an MR whose quotation request is live (and not yet ordered) is refused 409 QUOTATION_IN_PROGRESS;
 * the request's own raise-order is the way through.
 */
describe('quotation bypass guard', () => {
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

  const line = (mrLineId?: string, qty = 1) => ({
    lineType: 'MATERIAL' as const,
    materialCode: 'REBAR-12',
    description: 'Rebar',
    uomCode: 'TON',
    orderedQuantity: qty,
    unitPrice: 10,
    spendCategoryId: env.spendCategoryId,
    ...(mrLineId ? { mrLineAllocations: [{ materialRequestLineId: mrLineId, allocatedQuantity: qty }] } : {}),
  });
  const manualPo = (mrLineId?: string) =>
    svc.poService.create(env.as('collector'), {
      supplierId: env.supplierId,
      currencyCode: 'USD',
      effectiveFrom: '2026-10-01',
      lines: [line(mrLineId)],
    });
  const blocked = async (promise: Promise<unknown>) => {
    const error = (await promise.then(
      () => null,
      (e: unknown) => e,
    )) as { getStatus(): number; getResponse(): { details: Record<string, unknown> } } | null;
    expect(error).not.toBeNull();
    return { status: error!.getStatus(), details: error!.getResponse().details };
  };

  it('refuses a manual PO for an MR being quoted (collecting, sent, returned), with the request id', async () => {
    const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 10, estimate: 9 }] });
    const request = await s.collected(mr.id, ['Hodan']);
    const expected = {
      status: 409,
      details: { code: 'QUOTATION_IN_PROGRESS', quotationRequestId: request.id, quotationNumber: request.number, materialRequestId: mr.id },
    };
    expect(await blocked(manualPo(mr.lines[0].id))).toEqual(expected);
    await svc.collect.send(env.as('collector'), request.id);
    expect(await blocked(manualPo(mr.lines[0].id))).toEqual(expected);
    await svc.selection.askAnother(env.as('selector'), request.id, 'one more');
    expect(await blocked(manualPo(mr.lines[0].id))).toEqual(expected);
    // Nothing was written by the refused creates.
    expect(await prisma.purchaseOrderLineRequestAllocation.count({ where: { materialRequestLineId: mr.lines[0].id } })).toBe(0);
  });

  it('refuses allocating a revision line to it too', async () => {
    const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 10, estimate: 9 }] });
    const request = await s.collected(mr.id, ['Hodan']);
    const po = await manualPo();
    await svc.poService.confirm(env.as('collector'), po!.id);
    const revise = svc.poService.revise(env.as('collector'), po!.id, {
      reason: 'add the MR',
      currencyCode: 'USD',
      effectiveFrom: '2026-10-02',
      lines: [line(mr.lines[0].id)],
    });
    expect(await blocked(revise)).toMatchObject({ status: 409, details: { code: 'QUOTATION_IN_PROGRESS', quotationRequestId: request.id } });
  });

  it('an award not yet ordered blocks manual POs; its own raise-order goes through', async () => {
    const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 10, estimate: 9 }] });
    const request = await s.collected(mr.id, ['Hodan']);
    await svc.collect.send(env.as('collector'), request.id);
    await svc.selection.enterTotal(env.as('selector'), request.id, request.quotes[0].id, '90');
    await svc.awards.award(env.as('selector'), request.id, {
      quoteId: request.quotes[0].id,
      paymentPath: 'BUYER_CASH',
      awardSupplierId: env.supplierId,
    });
    expect(await blocked(manualPo(mr.lines[0].id))).toMatchObject({ status: 409, details: { code: 'QUOTATION_IN_PROGRESS' } });
    const { purchaseOrderId } = await svc.orders.raiseOrder(env.as('collector'), request.id, {});
    expect(purchaseOrderId).toBeTruthy();
  });

  it('a cancelled quotation request, or a PO with no MR allocation, is not blocked', async () => {
    const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 10, estimate: 9 }] });
    const request = await s.collected(mr.id, ['Hodan']);
    await expect(manualPo()).resolves.toBeTruthy();
    await svc.collect.cancel(env.as('collector'), request.id, 'buying direct');
    await expect(manualPo(mr.lines[0].id)).resolves.toBeTruthy();
  });
});
