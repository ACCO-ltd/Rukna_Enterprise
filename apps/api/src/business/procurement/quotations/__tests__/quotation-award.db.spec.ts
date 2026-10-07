import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { activateSodRules } from '../../__tests__/helpers/governance-fixture.js';
import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import {
  cleanupQuotationEnv,
  createApprovedMr,
  createQuotationEnv,
  setAwardBandsActive,
  type MrLineSpec,
  type QuotationTestEnv,
} from './helpers/quotation-fixture.js';
import { refusal, steps } from './helpers/quotation-steps.js';

/**
 * ADR-044 Q5 (live DB) — the award and its DoA integration. Scenarios S4, S5, S8, S9 (supplier
 * registration); refusals R4, R5, R9.
 */
describe('ADR-044 Q5 — award', () => {
  const prisma = new PrismaClient();
  let env: QuotationTestEnv;
  let svc: QuotationServices;
  let s: ReturnType<typeof steps>;

  beforeAll(async () => {
    env = await createQuotationEnv(prisma);
    svc = buildQuotationServices(prisma);
    s = steps(prisma, env, svc);
    await activateSodRules(prisma, env.orgId, ['QUOTE_UPLOADER_CANNOT_SELECT', 'REQUESTER_CANNOT_SELECT']);
  });

  afterAll(async () => {
    await cleanupQuotationEnv(prisma, env);
    await prisma.$disconnect();
  });

  /** A sent request whose quotes carry `totals` (one store per total). */
  async function priced(totals: string[], opts: { lines?: MrLineSpec[]; stores?: string[]; exception?: 'URGENT' } = {}) {
    const mr = await createApprovedMr(prisma, env, { lines: opts.lines });
    const request = await s.collected(mr.id, opts.stores ?? totals.map((_, i) => `Store ${i + 1} ${mr.id.slice(-6)}`));
    await svc.collect.send(env.as('collector'), request.id, opts.exception);
    let detail = await svc.query.detail(env.as('selector'), request.id);
    for (const [i, total] of totals.entries()) {
      detail = await svc.selection.enterTotal(env.as('selector'), request.id, detail.quotes[i].id, total);
    }
    return detail;
  }

  const approvalOf = (requestId: string) =>
    prisma.approvalInstance.findFirst({ where: { transactionId: requestId, transactionType: 'QUOTATION_AWARD' }, orderBy: { initiatedAt: 'desc' } });

  describe('bands inactive (today)', () => {
    it('S4: choosing the lowest awards in one call, with no approval instance', async () => {
      const request = await priced(['2350', '2410', '2295']);
      const lowest = request.quotes[2];
      const awarded = await svc.awards.award(env.as('selector'), request.id, {
        quoteId: lowest.id,
        paymentPath: 'FINANCE_PAYS_SUPPLIER',
      });
      expect(awarded).toMatchObject({ status: 'AWARDED', proposal: null, approval: null });
      expect(awarded.award).toMatchObject({
        quoteId: lowest.id,
        total: '2295.00',
        paymentPath: 'FINANCE_PAYS_SUPPLIER',
        nonLowestReason: null,
        approvalInstanceId: null,
        finalApprover: null,
      });
      expect(awarded.award?.awardedBy?.id).toBe(env.userIds.selector);
      expect(awarded.decidedAt).not.toBeNull();
      expect(await approvalOf(request.id)).toBeNull();
      expect(await s.events(request.id)).toEqual(
        expect.arrayContaining(['QUOTATION_AWARD_PROPOSED', 'QUOTATION_AWARDED']),
      );
    });

    it('S5: a non-lowest choice needs a reason, and OTHER needs a note', async () => {
      const request = await priced(['2350', '2410', '2295']);
      const pricier = request.quotes[0].id;
      expect(
        await refusal(svc.awards.award(env.as('selector'), request.id, { quoteId: pricier, paymentPath: 'BUYER_CASH' })),
      ).toEqual({ status: 409, code: 'NON_LOWEST_REASON_REQUIRED' });
      expect(
        await refusal(
          svc.awards.award(env.as('selector'), request.id, { quoteId: pricier, paymentPath: 'BUYER_CASH', nonLowestReason: 'OTHER' }),
        ),
      ).toEqual({ status: 409, code: 'NON_LOWEST_NOTE_REQUIRED' });
      const awarded = await svc.awards.award(env.as('selector'), request.id, {
        quoteId: pricier,
        paymentPath: 'BUYER_CASH',
        nonLowestReason: 'HAS_STOCK',
      });
      expect(awarded.award).toMatchObject({ quoteId: pricier, nonLowestReason: 'HAS_STOCK', paymentPath: 'BUYER_CASH' });
    });

    it('R4: an award with a quote lacking a total is refused', async () => {
      const mr = await createApprovedMr(prisma, env);
      const fresh = await s.collected(mr.id, ['A', 'B', 'C']);
      await svc.collect.send(env.as('collector'), fresh.id);
      await svc.selection.enterTotal(env.as('selector'), fresh.id, fresh.quotes[0].id, '50');
      expect(
        await refusal(svc.awards.award(env.as('selector'), fresh.id, { quoteId: fresh.quotes[0].id, paymentPath: 'BUYER_CASH' })),
      ).toEqual({ status: 409, code: 'QUOTE_TOTALS_MISSING' });
      expect((await svc.query.detail(env.as('selector'), fresh.id)).status).toBe('AWAITING_DECISION');
    });

    it('R5: fewer stores than required needs the exception AND its acceptance', async () => {
      // $500 estimate → 3 required; one quote sent with an URGENT exception.
      const short = await priced(['480'], { exception: 'URGENT' });
      const body = { quoteId: short.quotes[0].id, paymentPath: 'BUYER_CASH' as const };
      expect(await refusal(svc.awards.award(env.as('selector'), short.id, body))).toEqual({
        status: 409,
        code: 'QUOTE_COUNT_EXCEPTION_REQUIRED',
      });
      const awarded = await svc.awards.award(env.as('selector'), short.id, { ...body, acceptException: true });
      expect(awarded.status).toBe('AWARDED');
      expect(awarded.exceptionAccepted?.by?.id).toBe(env.userIds.selector);

      // $80 estimate → 1 required at send (no reason), but a $500 award needs 3: no exception on file.
      const cheap = await priced(['500'], { lines: [{ quantity: 1, estimate: 80 }] });
      expect(
        await refusal(
          svc.awards.award(env.as('selector'), cheap.id, { quoteId: cheap.quotes[0].id, paymentPath: 'BUYER_CASH', acceptException: true }),
        ),
      ).toEqual({ status: 409, code: 'QUOTE_COUNT_EXCEPTION_REQUIRED' });
    });

    it('S9: a new store wins — the award registers it, the selector is its vendor maintainer', async () => {
      const request = await priced(['90'], { lines: [{ quantity: 1, estimate: 90 }], stores: ['Bakaara  Steel Works'] });
      const awarded = await svc.awards.award(env.as('selector'), request.id, {
        quoteId: request.quotes[0].id,
        paymentPath: 'FINANCE_PAYS_SUPPLIER',
      });
      const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: awarded.award!.supplier!.id } });
      expect(supplier).toMatchObject({
        name: 'Bakaara Steel Works',
        status: 'ACTIVE',
        createdBy: env.userIds.selector,
        defaultCurrency: 'USD',
      });
      expect(supplier.code).toMatch(/^QS-\d{5}$/);
      const event = await prisma.auditOutboxEvent.findFirst({
        where: { aggregateType: 'Supplier', aggregateId: supplier.id },
      });
      expect(event?.eventType).toBe('SUPPLIER_CREATED_FROM_QUOTATION');
    });

    it('a selector without manage:payable cannot register a new store; choosing an existing supplier works', async () => {
      const request = await priced(['60'], { lines: [{ quantity: 1, estimate: 60 }], stores: ['Unregistered Hardware'] });
      const body = { quoteId: request.quotes[0].id, paymentPath: 'BUYER_CASH' as const };
      expect(await refusal(svc.awards.award(env.as('selector2'), request.id, body))).toEqual({
        status: 403,
        code: 'SUPPLIER_REGISTRATION_REQUIRES_PAYABLES',
      });
      const awarded = await svc.awards.award(env.as('selector2'), request.id, { ...body, awardSupplierId: env.supplierId });
      expect(awarded.award?.supplier?.id).toBe(env.supplierId);
      expect(await prisma.supplier.count({ where: { organizationId: env.orgId, name: 'Unregistered Hardware' } })).toBe(0);
    });

    it('a concurrent award and ask-another: exactly one wins', async () => {
      const request = await priced(['100', '200', '300']);
      const results = await Promise.allSettled([
        svc.awards.award(env.as('selector'), request.id, { quoteId: request.quotes[0].id, paymentPath: 'BUYER_CASH' }),
        svc.selection.askAnother(env.as('selector2'), request.id, 'one more'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((loser.reason as { getStatus(): number }).getStatus()).toBe(409);
    });
  });

  describe('bands active', () => {
    beforeAll(() => setAwardBandsActive(prisma, env, true));
    afterAll(() => setAwardBandsActive(prisma, env, false));

    it('$80 by a Finance Officer: gated on the CD-only band; CD approves; re-drive awards', async () => {
      const request = await priced(['80'], { lines: [{ quantity: 1, estimate: 80 }] });
      const body = { quoteId: request.quotes[0].id, paymentPath: 'BUYER_CASH' as const };
      const gated = await refusal(svc.awards.award(env.as('selector'), request.id, body));
      expect(gated).toEqual({ status: 409, code: 'AWARD_PENDING_APPROVAL' });
      const pending = await svc.query.detail(env.as('selector'), request.id);
      expect(pending.status).toBe('AWARD_PENDING_APPROVAL');
      expect(pending.proposal).toMatchObject({ quoteId: body.quoteId, paymentPath: 'BUYER_CASH' });
      expect(pending.approval).toMatchObject({ status: 'PENDING', currentStepRole: 'Construction Director' });

      // A different choice while pending is refused.
      expect(
        await refusal(svc.awards.award(env.as('selector'), request.id, { quoteId: 'other', paymentPath: 'BUYER_CASH' })),
      ).toEqual({ status: 409, code: 'AWARD_PENDING_DIFFERENT_CHOICE' });

      await svc.approvals.approve(pending.approval!.instanceId, env.userIds.director, ['Construction Director'], env.orgId);
      const awarded = await svc.awards.award(env.as('selector2'), request.id, {});
      expect(awarded.status).toBe('AWARDED');
      expect(awarded.award).toMatchObject({ approvalInstanceId: pending.approval!.instanceId });
      expect(awarded.award?.finalApprover?.id).toBe(env.userIds.director);
      expect(awarded.award?.awardedBy?.id).toBe(env.userIds.selector);
      expect(awarded.approval).toMatchObject({ status: 'APPROVED' });
      expect(awarded.approval!.steps[0].approvedBy?.id).toBe(env.userIds.director);
    });

    it('S8: $5,000 by a Finance Officer — the FO step is the selection; CD and CFO approve', async () => {
      const request = await priced(['5000', '5100', '5200']);
      const body = { quoteId: request.quotes[0].id, paymentPath: 'FINANCE_PAYS_SUPPLIER' as const };
      expect(await refusal(svc.awards.award(env.as('selector'), request.id, body))).toEqual({
        status: 409,
        code: 'AWARD_PENDING_APPROVAL',
      });
      let detail = await svc.query.detail(env.as('selector'), request.id);
      expect(detail.approval!.steps.map((st) => st.roleRequired)).toEqual(['Construction Director', 'Finance Officer', 'CFO']);
      await svc.approvals.approve(detail.approval!.instanceId, env.userIds.director, ['Construction Director'], env.orgId);

      // The selector re-drives: their own (now current) step is recorded as their approval.
      expect(await refusal(svc.awards.award(env.as('selector'), request.id, {}))).toEqual({
        status: 409,
        code: 'AWARD_PENDING_APPROVAL',
      });
      detail = await svc.query.detail(env.as('selector'), request.id);
      expect(detail.approval).toMatchObject({ status: 'PENDING', currentStepRole: 'CFO' });
      expect(detail.approval!.steps[1].approvedBy?.id).toBe(env.userIds.selector);
      const note = await prisma.approvalAction.findFirst({
        where: { instanceId: detail.approval!.instanceId, actorId: env.userIds.selector },
      });
      expect(note?.notes).toBe(`Selected in quotation ${request.number}`);

      await svc.approvals.approve(detail.approval!.instanceId, env.userIds.cfo, ['CFO'], env.orgId);
      const awarded = await svc.awards.award(env.as('selector'), request.id, {});
      expect(awarded.status).toBe('AWARDED');
      expect(awarded.award?.finalApprover?.id).toBe(env.userIds.cfo);
    });

    it('a selector holding every step role walks the whole chain in one call', async () => {
      const request = await priced(['5000', '5100', '5200']);
      const allRoles: RequestIdentity = {
        ...env.as('selector'),
        roles: ['Construction Director', 'Finance Officer', 'CFO', 'CEO'],
      };
      const awarded = await svc.awards.award(allRoles, request.id, {
        quoteId: request.quotes[0].id,
        paymentPath: 'BUYER_CASH',
      });
      expect(awarded.status).toBe('AWARDED');
      expect(awarded.approval!.steps.every((st) => st.approvedBy?.id === env.userIds.selector)).toBe(true);
    });

    it('R9: an approver who uploaded a quote → re-drive 403 and the instance is voided', async () => {
      const request = await priced(['80'], { lines: [{ quantity: 1, estimate: 80 }] });
      expect(
        (await refusal(svc.awards.award(env.as('selector'), request.id, { quoteId: request.quotes[0].id, paymentPath: 'BUYER_CASH' })))
          .code,
      ).toBe('AWARD_PENDING_APPROVAL');
      const instance = (await approvalOf(request.id))!;
      // The collector also holds the Construction Director role and approves the CD step.
      await svc.approvals.approve(instance.id, env.userIds.collector, ['Construction Director'], env.orgId);
      expect(await refusal(svc.awards.award(env.as('selector'), request.id, {}))).toEqual({
        status: 403,
        code: 'QUOTE_UPLOADER_CANNOT_SELECT',
      });
      expect((await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instance.id } })).status).toBe('CANCELLED');
      expect((await prisma.quotationRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe(
        'AWARD_PENDING_APPROVAL',
      );
      // The next re-drive opens a clean instance.
      expect((await refusal(svc.awards.award(env.as('selector'), request.id, {}))).code).toBe('AWARD_PENDING_APPROVAL');
      const fresh = (await approvalOf(request.id))!;
      expect(fresh.id).not.toBe(instance.id);
      expect(fresh.status).toBe('PENDING');
    });

    it('withdraw-award returns to AWAITING_DECISION, voids the instance and clears the proposal', async () => {
      const request = await priced(['80'], { lines: [{ quantity: 1, estimate: 80 }] });
      await refusal(svc.awards.award(env.as('selector'), request.id, { quoteId: request.quotes[0].id, paymentPath: 'BUYER_CASH' }));
      const instance = (await approvalOf(request.id))!;
      const withdrawn = await svc.awards.withdrawAward(env.as('selector2'), request.id);
      expect(withdrawn).toMatchObject({ status: 'AWAITING_DECISION', proposal: null, approval: null });
      expect((await prisma.approvalInstance.findUniqueOrThrow({ where: { id: instance.id } })).status).toBe('CANCELLED');
      expect(await refusal(svc.awards.withdrawAward(env.as('selector'), request.id))).toEqual({
        status: 409,
        code: 'QUOTATION_NOT_PENDING_APPROVAL',
      });
      expect(withdrawn.allowedActions.find((a) => a.action === 'AWARD')?.enabled).toBe(true);
      expect(PERMISSIONS.quotationsAward).toBe('award:quotation');
    });
  });
});
