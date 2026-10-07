import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

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

/**
 * Review H1 — an award approval is bound to the exact proposal it approved. A consumed instance
 * must have been opened for this proposal (after proposedAt) at this total; withdraw and cancel
 * void the open instance inside their own transaction, never after commit.
 */
describe('award approval binding (review H1)', () => {
  const prisma = new PrismaClient();
  let env: QuotationTestEnv;
  let svc: QuotationServices;
  let s: ReturnType<typeof steps>;

  beforeAll(async () => {
    env = await createQuotationEnv(prisma);
    svc = buildQuotationServices(prisma);
    s = steps(prisma, env, svc);
    await activateSodRules(prisma, env.orgId, ['QUOTE_UPLOADER_CANNOT_SELECT', 'REQUESTER_CANNOT_SELECT']);
    await setAwardBandsActive(prisma, env, true);
  });

  afterAll(async () => {
    await setAwardBandsActive(prisma, env, false);
    await cleanupQuotationEnv(prisma, env);
    await prisma.$disconnect();
  });

  /** A $80 proposal pending on the CD step, then approved by the CD. */
  async function approvedAt80() {
    const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 1, estimate: 80 }] });
    const request = await s.collected(mr.id, ['Hodan']);
    await svc.collect.send(env.as('collector'), request.id);
    await svc.selection.enterTotal(env.as('selector'), request.id, request.quotes[0].id, '80');
    const body = { quoteId: request.quotes[0].id, paymentPath: 'BUYER_CASH' as const, awardSupplierId: env.supplierId };
    expect((await refusal(svc.awards.award(env.as('selector'), request.id, body))).code).toBe('AWARD_PENDING_APPROVAL');
    const instance = (await prisma.approvalInstance.findFirst({
      where: { transactionId: request.id, transactionType: 'QUOTATION_AWARD' },
    }))!;
    await svc.approvals.approve(instance.id, env.userIds.director, ['Construction Director'], env.orgId);
    return { request, instance, body };
  }

  it('an approval granted for a $80 proposal cannot be consumed by a later $40,000 proposal', async () => {
    const { request, instance } = await approvedAt80();
    // A withdraw + re-total + re-propose whose void raced/was lost: same quote, new proposal at $40k.
    await prisma.quote.update({ where: { id: request.quotes[0].id }, data: { enteredTotal: new Decimal('40000') } });
    await prisma.quotationRequest.update({ where: { id: request.id }, data: { proposedAt: new Date(Date.now() + 1000) } });

    const redrive = await refusal(svc.awards.award(env.as('selector'), request.id, {}));
    expect(redrive.code).toBe('AWARD_PENDING_APPROVAL');
    const after = await prisma.quotationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe('AWARD_PENDING_APPROVAL');
    expect(after.awardedTotal).toBeNull();
    // The stale $80 instance is voided; a fresh one is opened at $40,000.
    expect((await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instance.id } })).status).toBe('CANCELLED');
    const fresh = await prisma.approvalInstance.findFirst({
      where: { transactionId: request.id, transactionType: 'QUOTATION_AWARD', status: 'PENDING' },
    });
    expect(fresh?.evaluatedAmount?.toString()).toBe('40000');
  });

  it('withdraw voids the open instance inside its own transaction', async () => {
    const { request, instance } = await approvedAt80();
    const original = svc.commandGovernance.voidOpenApproval.bind(svc.commandGovernance);
    svc.commandGovernance.voidOpenApproval = async () => {
      throw new Error('after-commit void must not be needed');
    };
    try {
      const detail = await svc.awards.withdrawAward(env.as('selector'), request.id);
      expect(detail.status).toBe('AWAITING_DECISION');
    } finally {
      svc.commandGovernance.voidOpenApproval = original;
    }
    expect((await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instance.id } })).status).toBe('CANCELLED');
  });

  it('cancel voids the open instance inside its own transaction', async () => {
    const { request, instance } = await approvedAt80();
    const original = svc.commandGovernance.voidOpenApproval.bind(svc.commandGovernance);
    svc.commandGovernance.voidOpenApproval = async () => {
      throw new Error('after-commit void must not be needed');
    };
    try {
      expect((await svc.collect.cancel(env.as('selector'), request.id, 'not needed')).status).toBe('CANCELLED');
    } finally {
      svc.commandGovernance.voidOpenApproval = original;
    }
    expect((await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instance.id } })).status).toBe('CANCELLED');
  });

  it('the matching approval still completes the award', async () => {
    const { request, instance } = await approvedAt80();
    const awarded = await svc.awards.award(env.as('selector2'), request.id, {});
    expect(awarded.status).toBe('AWARDED');
    expect(awarded.award).toMatchObject({ total: '80.00', approvalInstanceId: instance.id });
  });
});
