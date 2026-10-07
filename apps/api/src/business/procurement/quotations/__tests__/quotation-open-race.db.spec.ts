import { PrismaClient } from '@prisma/client';

import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import { cleanupQuotationEnv, createApprovedMr, createQuotationEnv, type QuotationTestEnv } from './helpers/quotation-fixture.js';
import { refusal } from './helpers/quotation-steps.js';

/**
 * Review L2 — opening a quotation round and allocating a manual PO line to the same MR serialise on
 * the MR's row lock, so a PO cannot slip in while the round is being opened.
 */
describe('open vs manual allocation race (review L2)', () => {
  const prisma = new PrismaClient();
  let env: QuotationTestEnv;
  let svc: QuotationServices;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    env = await createQuotationEnv(prisma);
    svc = buildQuotationServices(prisma);
  });

  afterAll(async () => {
    await cleanupQuotationEnv(prisma, env);
    await prisma.$disconnect();
  });

  it('a manual PO waits for an in-flight open and is then refused', async () => {
    const mr = await createApprovedMr(prisma, env);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // An open() in flight: it holds the MR lock and has inserted the round, not yet committed.
    const opening = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM material_requests WHERE id = ${mr.id} FOR UPDATE`;
        await tx.quotationRequest.create({
          data: { organizationId: env.orgId, number: `QR-RACE-${mr.id.slice(-6)}`, materialRequestId: mr.id, currencyCode: 'USD', createdBy: env.userIds.collector },
        });
        await gate;
      },
      { timeout: 30_000 },
    );
    await pause(300);
    const manual = refusal(
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
            orderedQuantity: 1,
            unitPrice: 1,
            spendCategoryId: env.spendCategoryId,
            mrLineAllocations: [{ materialRequestLineId: mr.lines[0].id, allocatedQuantity: 1 }],
          },
        ],
      }),
    );
    await pause(1000);
    release();
    await opening;
    expect(await manual).toEqual({ status: 409, code: 'QUOTATION_IN_PROGRESS' });
  }, 60_000);
});
