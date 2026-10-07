import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import { cleanupQuotationEnv, createApprovedMr, createQuotationEnv, type QuotationTestEnv } from './helpers/quotation-fixture.js';
import { steps } from './helpers/quotation-steps.js';

/** Review L1 — the stored PO line amounts (Decimal(18,2)) never sum above the award. */
describe('raise-order rounding (review L1)', () => {
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

  it('0.505 / 0.495 split of a $1.00 award stores line amounts summing to ≤ $1.00', async () => {
    const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 1, estimate: 0.505 }, { quantity: 1, estimate: 0.495 }] });
    const request = await s.collected(mr.id, ['Hodan']);
    await svc.collect.send(env.as('collector'), request.id);
    await svc.selection.enterTotal(env.as('selector'), request.id, request.quotes[0].id, '1.00');
    await svc.awards.award(env.as('selector'), request.id, {
      quoteId: request.quotes[0].id,
      paymentPath: 'BUYER_CASH',
      awardSupplierId: env.supplierId,
    });
    const { purchaseOrderId } = await svc.orders.raiseOrder(env.as('collector'), request.id, {});
    const lines = await prisma.purchaseOrderLine.findMany({ where: { revision: { purchaseOrderId } } });
    const stored = lines.reduce((sum, l) => sum.add(new Decimal(l.extendedAmount.toString())), new Decimal(0));
    expect(stored.lessThanOrEqualTo(new Decimal('1.00'))).toBe(true);
    // The order still confirms as covered by the award.
    await svc.poService.confirm(env.as('collector'), purchaseOrderId);
  });
});
