import { PrismaClient } from '@prisma/client';

import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import { cleanupQuotationEnv, createApprovedMr, createQuotationEnv, type QuotationTestEnv } from './helpers/quotation-fixture.js';
import { steps } from './helpers/quotation-steps.js';

/**
 * Review L3 — cancelling an AWARDED request whose order is still a DRAFT cancels that draft PO in
 * the same transaction (both audited), so no orphaned award-priced draft remains.
 */
describe('cancel an awarded request with a draft PO (review L3)', () => {
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

  it('cancels the draft PO with the request, audits both, and frees the MR for a new round', async () => {
    const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 1, estimate: 90 }] });
    const request = await s.collected(mr.id, ['Hodan']);
    await svc.collect.send(env.as('collector'), request.id);
    await svc.selection.enterTotal(env.as('selector'), request.id, request.quotes[0].id, '90');
    await svc.awards.award(env.as('selector'), request.id, {
      quoteId: request.quotes[0].id,
      paymentPath: 'BUYER_CASH',
      awardSupplierId: env.supplierId,
    });
    const { purchaseOrderId } = await svc.orders.raiseOrder(env.as('collector'), request.id, {});

    const cancelled = await svc.collect.cancel(env.as('collector'), request.id, 'Store closed');
    expect(cancelled.status).toBe('CANCELLED');
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, include: { revisions: true } });
    expect(po.status).toBe('CANCELLED');
    expect(po.revisions.every((r) => r.status === 'CANCELLED')).toBe(true);
    const poAudit = await prisma.auditOutboxEvent.findFirst({ where: { aggregateType: 'PurchaseOrder', aggregateId: purchaseOrderId, eventType: 'PO_CANCELLED' } });
    expect(poAudit).not.toBeNull();
    expect(await s.events(request.id)).toContain('QUOTATION_CANCELLED');

    // Nothing is left ordered on the MR, so a new round can open.
    expect((await svc.collect.open(env.as('collector'), mr.id)).created).toBe(true);
  });
});
