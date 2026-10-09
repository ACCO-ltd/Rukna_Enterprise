import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { activateSodRules } from '../../../procurement/__tests__/helpers/governance-fixture.js';
import { refusal } from '../../../procurement/quotations/__tests__/helpers/quotation-steps.js';
import { awardSteps } from './helpers/award-steps.js';
import { buildPaymentServices, type PaymentServices } from './helpers/build-payment-services.js';
import { balances, cleanupPaymentEnv, createPaymentEnv, journalLines, type PaymentTestEnv } from './helpers/payment-fixture.js';

/**
 * ADR-045 P4 (live DB) — buyer cash: release (EVT-AP-007), DoA gate, SoD, cap, idempotency,
 * reverse, change returned (EVT-AP-009), legacy advances.
 */
describe('ADR-045 P4 — buyer advance release, reverse, return', () => {
  const prisma = new PrismaClient();
  let env: PaymentTestEnv;
  let svc: PaymentServices;
  let a: ReturnType<typeof awardSteps>;

  beforeAll(async () => {
    env = await createPaymentEnv(prisma);
    svc = buildPaymentServices(prisma);
    a = awardSteps(prisma, env, svc);
    await activateSodRules(prisma, env.orgId, [
      'QUOTE_UPLOADER_CANNOT_SELECT',
      'REQUESTER_CANNOT_SELECT',
      'ADVANCE_RECIPIENT_CANNOT_RELEASE',
      'VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT',
    ]);
  });

  afterAll(async () => {
    await cleanupPaymentEnv(prisma, env);
    await prisma.$disconnect();
  });

  const advancesOf = (poId: string) => prisma.buyerAdvance.findMany({ where: { purchaseOrderId: poId } });
  const journalsOf = (advanceId: string) =>
    prisma.journalEntry.findMany({ where: { sourceDocumentType: 'BUYER_ADVANCE', sourceDocumentId: advanceId } });

  it('S2: one tap releases and posts EVT-AP-007 Dr Staff advances / Cr cash box on advancedAt', async () => {
    const { requestId, poId } = await a.awardedOrder();
    const before = await balances(prisma, env.orgId);
    const result = await a.release(requestId);
    expect(result.advance).toMatchObject({
      documentStatus: 'APPROVED',
      postingStatus: 'POSTED',
      approvedBy: env.userIds.selector,
      recipientUserId: env.userIds.collector,
      quotationRequestId: requestId,
      legacy: false,
    });
    expect(result.advance.outstanding.toFixed(2)).toBe('1000.00');
    const { entry, lines } = await journalLines(prisma, result.advance.postedJournalEntryId!);
    expect(lines).toEqual([
      ['13100', '1000.00', '0.00'],
      ['10900', '0.00', '1000.00'],
    ]);
    expect(entry).toMatchObject({
      accountingEventId: 'EVT-AP-007',
      sourceDocumentType: 'BUYER_ADVANCE',
      sourceDocumentId: result.advance.id,
      journalCategory: 'CASH_AND_BANK',
    });
    expect(entry.accountingDate.toISOString().slice(0, 10)).toBe('2026-10-08');
    expect(entry.documentDate.toISOString().slice(0, 10)).toBe('2026-10-08');
    const dims = await prisma.journalLine.findMany({ where: { journalEntryId: entry.id }, select: { projectId: true, resolutionSource: true } });
    expect(dims.map((d) => d.projectId)).toEqual([env.projectId, env.projectId]);
    expect(dims[0].resolutionSource).toBe('STAFF_ADVANCE@v1');
    const after = await balances(prisma, env.orgId);
    expect(Number(after['13100'] ?? 0) - Number(before['13100'] ?? 0)).toBe(1000);
    const events = await prisma.auditOutboxEvent.findMany({ where: { aggregateType: 'BuyerAdvance', aggregateId: result.advance.id }, select: { eventType: true } });
    expect(events.map((e) => e.eventType).sort()).toEqual(['BUYER_ADVANCE_CREATED', 'BUYER_ADVANCE_RELEASED']);
    expect(await advancesOf(poId)).toHaveLength(1);
  });

  it('S13: a double tap (same key) gives one advance and one journal; a reused key with another amount is refused', async () => {
    const { requestId, poId } = await a.awardedOrder();
    const key = randomUUID();
    const [first, second] = await Promise.all([a.release(requestId, { key, amount: '400.00' }), a.release(requestId, { key, amount: '400.00' })]);
    expect(second.advance.id).toBe(first.advance.id);
    expect(await advancesOf(poId)).toHaveLength(1);
    expect(await journalsOf(first.advance.id)).toHaveLength(1);
    expect(await refusal(a.release(requestId, { key, amount: '401.00' }))).toEqual({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('a back-dated release posts on its own date, never today', async () => {
    const { requestId } = await a.awardedOrder();
    const result = await a.release(requestId, { advancedAt: '2026-10-07', amount: '10.00' });
    const { entry } = await journalLines(prisma, result.advance.postedJournalEntryId!);
    expect(entry.accountingDate.toISOString().slice(0, 10)).toBe('2026-10-07');
  });

  it('R3: funded may reach the order but not pass it (409 FUNDING_EXCEEDS_ORDER with the figures)', async () => {
    const { requestId } = await a.awardedOrder();
    await a.release(requestId, { amount: '600.00' });
    expect(await refusal(a.release(requestId, { amount: '400.01' }))).toEqual({ status: 409, code: 'FUNDING_EXCEEDS_ORDER' });
    await expect(a.release(requestId, { amount: '400.01' })).rejects.toMatchObject({
      response: { details: { orderedAmount: '1000.00', funded: '600.00', requested: '400.01' } },
    });
    await expect(a.release(requestId, { amount: '400.00' })).resolves.toBeTruthy();
  });

  it('R3 (race): two concurrent releases on one order cannot pass the cap', async () => {
    const { requestId, poId } = await a.awardedOrder();
    const results = await Promise.allSettled([a.release(requestId, { amount: '600.00' }), a.release(requestId, { amount: '600.00' })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const live = (await advancesOf(poId)).filter((x) => x.postingStatus === 'POSTED');
    expect(live).toHaveLength(1);
  });

  it('R1/R2/R4/R5/R6: refusals before anything is written', async () => {
    const { requestId, poId } = await a.awardedOrder();
    const supplierPath = await a.awardedOrder({ path: 'FINANCE_PAYS_SUPPLIER' });
    expect(await refusal(a.release(supplierPath.requestId))).toEqual({ status: 409, code: 'PAYMENT_PATH_MISMATCH' });
    expect(await refusal(a.release(requestId, { recipient: env.userIds.selector }))).toEqual({
      status: 403,
      code: 'ADVANCE_RECIPIENT_CANNOT_RELEASE',
    });
    expect(await refusal(a.release(requestId, { recipient: env.userIds.pm }))).toEqual({ status: 422, code: 'ADVANCE_RECIPIENT_INVALID' });
    expect(await refusal(a.release(requestId, { bankAccountId: env.bank.mainBankId }))).toEqual({
      status: 409,
      code: 'ACCOUNT_REQUIRES_DUAL_CONTROL',
    });
    await prisma.purchaseOrder.update({ where: { id: poId }, data: { status: 'CLOSED' } });
    expect(await refusal(a.release(requestId))).toEqual({ status: 409, code: 'PAYMENT_PO_NOT_OPEN' });
    await prisma.purchaseOrder.update({ where: { id: poId }, data: { status: 'OPEN' } });
    expect(await advancesOf(poId)).toHaveLength(0);
  });

  it('R7: no STAFF_ADVANCE profile on advancedAt → 409, nothing written', async () => {
    const { requestId, poId } = await a.awardedOrder({ effectiveFrom: '2025-12-01' });
    expect(await refusal(a.release(requestId, { advancedAt: '2025-12-31' }))).toEqual({
      status: 409,
      code: 'POSTING_ACCOUNT_NOT_CONFIGURED:STAFF_ADVANCE',
    });
    expect(await advancesOf(poId)).toHaveLength(0);
  });

  it('R8: a closed period refuses the release before anything is written', async () => {
    const { requestId, poId } = await a.awardedOrder({ effectiveFrom: '2026-09-01' });
    const sept = await prisma.accountingPeriod.findFirstOrThrow({ where: { organizationId: env.orgId, startDate: new Date('2026-09-01') } });
    await prisma.accountingPeriod.update({ where: { id: sept.id }, data: { status: 'CLOSED' } });
    try {
      expect(await refusal(a.release(requestId, { advancedAt: '2026-09-30' }))).toEqual({ status: 409, code: 'PERIOD_CLOSED' });
      expect(await advancesOf(poId)).toHaveLength(0);
    } finally {
      await prisma.accountingPeriod.update({ where: { id: sept.id }, data: { status: 'OPEN' } });
    }
  });

  describe('bands active', () => {
    beforeAll(() => a.setPaymentBandsActive(true));
    afterAll(() => a.setPaymentBandsActive(false));

    it('≤ $1k: the Finance Officer tap is the approval — released in the same request', async () => {
      const { requestId } = await a.awardedOrder();
      const result = await a.release(requestId, { amount: '900.00' });
      expect(result.advance.postingStatus).toBe('POSTED');
      expect(result.advance.approvalInstanceId).toBeTruthy();
    });

    it('S3: $4,000 → FO step from the tap, 409 { approvalInstanceId }; CFO approves; re-drive posts once', async () => {
      const { requestId, poId } = await a.awardedOrder({ total: '4000.00' });
      const key = randomUUID();
      const gated = await a.release(requestId, { amount: '4000.00', key }).catch((e) => e);
      expect(gated.getStatus()).toBe(409);
      const { approvalInstanceId, code } = gated.getResponse().details;
      expect(code).toBe('APPROVAL_REQUIRED');
      const [draft] = await advancesOf(poId);
      expect(draft).toMatchObject({ documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED', approvalInstanceId });
      expect(await journalsOf(draft.id)).toHaveLength(0);
      expect((await svc.query.detail(env.as('selector'), requestId)).payment).toMatchObject({ released: '0.00', withBuyer: '0.00', pendingAmount: '4000.00' });
      const pending = (await svc.query.detail(env.as('selector'), requestId)).payment!.pending;
      expect(pending).toEqual([
        expect.objectContaining({ kind: 'BUYER_ADVANCE', id: draft.id, idempotencyKey: key, awaiting: 'APPROVAL', approvalInstanceId, continue: { method: 'POST', path: `/buyer-advances/${draft.id}/post` } }),
      ]);
      const actions = await prisma.approvalAction.findMany({ where: { instanceId: approvalInstanceId } });
      expect(actions.map((x) => [x.stepOrder, x.actorId])).toEqual([[1, env.userIds.selector]]);

      // Re-tap before the CFO decides: still waiting, same instance.
      expect(await refusal(a.release(requestId, { amount: '4000.00', key }))).toEqual({ status: 409, code: 'APPROVAL_REQUIRED' });
      await svc.approvals.approve(approvalInstanceId, env.userIds.cfo, ['CFO'], env.orgId);
      const done = await a.release(requestId, { amount: '4000.00', key }, env.payer2);
      expect(done.advance).toMatchObject({ id: draft.id, postingStatus: 'POSTED', approvedBy: env.userIds.cfo });
      expect(await journalsOf(draft.id)).toHaveLength(1);
    });

    it('R18: an approver who is the recipient voids the instance (403) on re-drive', async () => {
      const { requestId } = await a.awardedOrder({ total: '4000.00', extraCollector: true });
      const gated = await a.release(requestId, { amount: '4000.00', recipient: env.userIds.collector2 }).catch((e) => e);
      const { approvalInstanceId } = gated.getResponse().details;
      // The recipient happens to hold the CFO step.
      await svc.approvals.approve(approvalInstanceId, env.userIds.collector2, ['CFO'], env.orgId);
      const draft = await prisma.buyerAdvance.findFirstOrThrow({ where: { quotationRequestId: requestId } });
      expect(await refusal(svc.advances.post(env.payer2, draft.id))).toEqual({ status: 403, code: 'ADVANCE_RECIPIENT_CANNOT_RELEASE' });
      const instance = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: approvalInstanceId } });
      expect(instance.status).toBe('CANCELLED');
      expect((await prisma.buyerAdvance.findUniqueOrThrow({ where: { id: draft.id } })).postingStatus).toBe('NOT_POSTED');
    });
  });

  describe('review fixes', () => {
    it('H3: a DRAFT waiting for approval is re-checked when re-driven (dual control, closed order, path) — the approval is not burnt', async () => {
      await a.setPaymentBandsActive(true);
      try {
        const { requestId, poId } = await a.awardedOrder({ total: '4000.00' });
        const gated = await a.release(requestId, { amount: '4000.00' }).catch((e) => e);
        const { approvalInstanceId, advanceId } = gated.getResponse().details;
        await svc.approvals.approve(approvalInstanceId, env.userIds.cfo, ['CFO'], env.orgId);
        // The cash box came under dual control meanwhile.
        const sig = await prisma.bankAccountSignatory.create({
          data: { organizationId: env.orgId, bankAccountId: env.bank.cashBoxId, userId: env.userIds.cfo, addedBy: env.identity.userId },
        });
        try {
          expect(await refusal(svc.advances.post(env.payer2, advanceId))).toEqual({ status: 409, code: 'ACCOUNT_REQUIRES_DUAL_CONTROL' });
        } finally {
          await prisma.bankAccountSignatory.delete({ where: { id: sig.id } });
        }
        expect((await prisma.approvalInstance.findUniqueOrThrow({ where: { id: approvalInstanceId } })).status).toBe('APPROVED');
        await prisma.quotationRequest.update({ where: { id: requestId }, data: { paymentPath: 'FINANCE_PAYS_SUPPLIER' } });
        expect(await refusal(svc.advances.post(env.payer2, advanceId))).toEqual({ status: 409, code: 'PAYMENT_PATH_MISMATCH' });
        await prisma.quotationRequest.update({ where: { id: requestId }, data: { paymentPath: 'BUYER_CASH' } });
        await prisma.purchaseOrder.update({ where: { id: poId }, data: { status: 'CLOSED' } });
        expect(await refusal(svc.advances.post(env.payer2, advanceId))).toEqual({ status: 409, code: 'PAYMENT_PO_NOT_OPEN' });
        await prisma.purchaseOrder.update({ where: { id: poId }, data: { status: 'OPEN' } });
        expect(await journalsOf(advanceId)).toHaveLength(0);
        // Body-less re-drive (another device) completes it once.
        const posted = await svc.advances.post(env.payer2, advanceId);
        expect(posted.postingStatus).toBe('POSTED');
        expect((await prisma.approvalInstance.findUniqueOrThrow({ where: { id: approvalInstanceId } })).status).toBe('CANCELLED');
      } finally {
        await a.setPaymentBandsActive(false);
      }
    });

    it('M7: releases are banded on the cumulative funding of the order (2 × $900 → the CFO band)', async () => {
      await a.setPaymentBandsActive(true);
      try {
        const { requestId } = await a.awardedOrder({ total: '2000.00' });
        await expect(a.release(requestId, { amount: '900.00' })).resolves.toBeTruthy();
        const second = await a.release(requestId, { amount: '900.00' }).catch((e) => e);
        expect(second.getResponse().details.code).toBe('APPROVAL_REQUIRED');
        const inst = await prisma.approvalInstance.findUniqueOrThrow({ where: { id: second.getResponse().details.approvalInstanceId } });
        expect(inst.evaluatedAmount?.toString()).toBe('1800');
      } finally {
        await a.setPaymentBandsActive(false);
      }
    });

    it('M1 / LOW: returns and applications are idempotent on their key; a release replay must match every field', async () => {
      const { requestId } = await a.awardedOrder();
      const key = randomUUID();
      const { advance } = await a.release(requestId, { amount: '100.00', key });
      expect(await refusal(a.release(requestId, { amount: '100.00', key, method: 'MOBILE_MONEY' }))).toEqual({
        status: 409,
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
      const retKey = randomUUID();
      const body = {
        idempotencyKey: retKey,
        amount: '10.00',
        returnMethod: 'CASH',
        destinationBankAccountId: env.bank.cashBoxId,
        receivedBy: env.userIds.selector,
        receivedAt: '2026-10-09',
      };
      const [r1, r2] = await Promise.all([
        svc.advances.createReturn(env.as('selector'), advance.id, body),
        svc.advances.createReturn(env.as('selector'), advance.id, body).catch(() => svc.advances.createReturn(env.as('selector'), advance.id, body)),
      ]);
      expect(r2.id).toBe(r1.id);
      expect(await prisma.advanceReturn.count({ where: { buyerAdvanceId: advance.id } })).toBe(1);
      expect(await refusal(svc.advances.createReturn(env.as('selector'), advance.id, { ...body, amount: '11.00' }))).toEqual({
        status: 409,
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
    });
  });

  it('QA D: three concurrent same-key full-amount releases all return the same advance (no 409)', async () => {
    const { requestId, poId } = await a.awardedOrder();
    const key = randomUUID();
    const results = await Promise.all([1, 2, 3].map(() => a.release(requestId, { key, amount: '1000.00' })));
    expect(new Set(results.map((r) => r.advance.id)).size).toBe(1);
    expect(await advancesOf(poId)).toHaveLength(1);
    expect(await journalsOf(results[0].advance.id)).toHaveLength(1);
  });

  it('QA LOW: cash dated before the order is refused; a waiting or reversed advance is not released money', async () => {
    const { requestId } = await a.awardedOrder();
    expect(await refusal(a.release(requestId, { advancedAt: '2026-09-30', amount: '10.00' }))).toEqual({
      status: 422,
      code: 'DATE_BEFORE_ORDER',
    });
    const { advance } = await a.release(requestId, { amount: '100.00' });
    await svc.advances.reverse(env.as('selector'), advance.id, { reason: 'mistake', reversalDate: '2026-10-09' });
    const p = (await svc.query.detail(env.as('selector'), requestId)).payment!;
    expect(p).toMatchObject({ released: '0.00', withBuyer: '0.00' });
    expect(p.advances![0]).toMatchObject({ outstanding: '0.00', postingStatus: 'REVERSED' });
    const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: advance.postedJournalEntryId! } });
    expect(je.description).not.toMatch(/c[a-z0-9]{24}/);
  });

  describe('change returned and reverse', () => {
    it('S6 (return part): change returned posts EVT-AP-009 on receivedAt; over-return is refused (R11)', async () => {
      const { requestId } = await a.awardedOrder();
      const { advance } = await a.release(requestId, { amount: '100.00' });
      expect(
        await refusal(
          svc.advances.createReturn(env.as('selector'), advance.id, {
            amount: '100.01',
            returnMethod: 'CASH',
            destinationBankAccountId: env.bank.cashBoxId,
            receivedBy: env.userIds.selector,
            receivedAt: '2026-10-09',
          }),
        ),
      ).toEqual({ status: 422, code: 'RETURN_EXCEEDS_OUTSTANDING' });
      const ret = await svc.advances.createReturn(env.as('selector'), advance.id, {
        amount: '20.00',
        returnMethod: 'CASH',
        destinationBankAccountId: env.bank.cashBoxId,
        receivedBy: env.userIds.selector,
        receivedAt: '2026-10-09',
      });
      const { entry, lines } = await journalLines(prisma, ret.journalEntryId!);
      expect(lines).toEqual([
        ['10900', '20.00', '0.00'],
        ['13100', '0.00', '20.00'],
      ]);
      expect(entry.accountingEventId).toBe('EVT-AP-009');
      expect(entry.accountingDate.toISOString().slice(0, 10)).toBe('2026-10-09');
      const after = await svc.advances.findById(env.as('selector'), advance.id);
      expect(after.outstanding.toFixed(2)).toBe('80.00');

      // R15: settled in part → cannot be reversed.
      expect(await refusal(svc.advances.reverse(env.as('selector'), advance.id, { reason: 'x', reversalDate: '2026-10-09' }))).toEqual({
        status: 409,
        code: 'ADVANCE_HAS_SETTLEMENTS',
      });
    });

    it('reverse: the mirror journal on reversalDate; the cap room is freed', async () => {
      const { requestId } = await a.awardedOrder();
      const { advance } = await a.release(requestId, { amount: '1000.00' });
      expect(await refusal(svc.advances.reverse(env.as('selector'), advance.id, { reason: 'wrong buyer', reversalDate: '2026-10-07' }))).toEqual({
        status: 422,
        code: 'DATE_INVALID',
      });
      const reversed = await svc.advances.reverse(env.as('selector'), advance.id, { reason: 'wrong buyer', reversalDate: '2026-10-10' });
      expect(reversed).toMatchObject({ postingStatus: 'REVERSED', reversalReason: 'wrong buyer' });
      const { entry, lines } = await journalLines(prisma, reversed.reversalJournalEntryId!);
      expect(lines).toEqual([
        ['13100', '0.00', '1000.00'],
        ['10900', '1000.00', '0.00'],
      ]);
      expect(entry).toMatchObject({ accountingEventId: 'EVT-AP-010', entryPurpose: 'REVERSAL', reversalOfJournalEntryId: advance.postedJournalEntryId });
      expect(entry.accountingDate.toISOString().slice(0, 10)).toBe('2026-10-10');
      await expect(a.release(requestId, { amount: '1000.00' })).resolves.toBeTruthy();
    });
  });

  describe('legacy advances (posted before GL posting)', () => {
    it('are never re-posted, keep their arithmetic, and their returns post no journal', async () => {
      const { poId } = await a.awardedOrder();
      const legacy = await prisma.buyerAdvance.create({
        data: {
          organizationId: env.orgId,
          purchaseOrderId: poId,
          recipientUserId: env.userIds.collector,
          amount: new Decimal('300'),
          currencyCode: 'USD',
          paymentMethod: 'BANK',
          disbursementBankAccountId: env.bank.cashBoxId,
          advancedAt: new Date('2026-09-15'),
          postingStatus: 'POSTED',
          postedAt: new Date('2026-09-15'),
          postedBy: env.userIds.selector,
          createdBy: env.userIds.selector,
        },
      });
      await expect(svc.advances.post(env.as('selector'), legacy.id)).rejects.toMatchObject({ status: 409 });
      expect(await journalsOf(legacy.id)).toHaveLength(0);
      const read = await svc.advances.findById(env.as('selector'), legacy.id);
      expect(read).toMatchObject({ legacy: true });
      expect(read.outstanding.toFixed(2)).toBe('300.00');
      const ret = await svc.advances.createReturn(env.as('selector'), legacy.id, {
        amount: '50',
        returnMethod: 'CASH',
        destinationBankAccountId: env.bank.cashBoxId,
        receivedBy: env.userIds.selector,
        receivedAt: '2026-10-09',
      });
      expect(ret.journalEntryId).toBeNull();
      expect((await svc.advances.findById(env.as('selector'), legacy.id)).outstanding.toFixed(2)).toBe('250.00');
      expect(await refusal(svc.advances.reverse(env.as('selector'), legacy.id, { reason: 'x', reversalDate: '2026-10-09' }))).toEqual({
        status: 409,
        code: 'ADVANCE_LEGACY',
      });
    });
  });
});
