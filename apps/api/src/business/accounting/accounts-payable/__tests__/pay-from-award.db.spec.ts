import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { activateSodRules } from '../../../procurement/__tests__/helpers/governance-fixture.js';
import { createUploadedPhoto } from '../../../procurement/quotations/__tests__/helpers/quotation-fixture.js';
import { refusal } from '../../../procurement/quotations/__tests__/helpers/quotation-steps.js';
import { awardSteps } from './helpers/award-steps.js';
import { buildPaymentServices, type PaymentServices } from './helpers/build-payment-services.js';
import { cleanupPaymentEnv, createPaymentEnv, journalLines, type PaymentTestEnv } from './helpers/payment-fixture.js';

/**
 * ADR-045 P7 (live DB) — FINANCE_PAYS_SUPPLIER: pay the awarded store from the award (prepay /
 * pay the bill), dual control, bands, SoD, idempotency, and the prepayment applied to the bill.
 */
describe('ADR-045 P7 — pay supplier from the award', () => {
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
      'VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT',
      'BILL_APPROVER_CANNOT_APPROVE_OR_RELEASE_PAYMENT',
      'GOODS_RECEIVER_CANNOT_APPROVE_BILL',
    ]);
  });

  afterAll(async () => {
    await cleanupPaymentEnv(prisma, env);
    await prisma.$disconnect();
  });

  const pay = (
    requestId: string,
    over: Partial<{ amount: string; shape: 'PREPAY' | 'PAY_BILL'; bankAccountId: string; key: string; supplierBillId: string }> = {},
    as = env.as('selector'),
  ) =>
    svc.awardPayments.payFromAward(as, {
      idempotencyKey: over.key ?? randomUUID(),
      quotationRequestId: requestId,
      bankAccountId: over.bankAccountId ?? env.bank.evcId,
      paymentMethod: 'MOBILE_MONEY',
      paymentDate: '2026-10-08',
      amount: over.amount ?? '1000.00',
      shape: over.shape ?? 'PREPAY',
      supplierBillId: over.supplierBillId,
    });

  async function invoice(poId: string) {
    const file = await createUploadedPhoto(prisma, env, 'collector');
    return svc.storeDocuments.create(env.as('collector'), {
      clientRef: randomUUID(),
      purchaseOrderId: poId,
      kind: 'INVOICE',
      photos: [{ platformFileId: file.id, capturedAt: '2026-10-08T10:42:00.000Z', source: 'CAMERA' }],
    });
  }

  it('S8 + S9: pay now before goods (supplier advance + PO allocation); then the invoice is recorded and the prepayment settles it', async () => {
    const { requestId, poId } = await a.awardedOrder({ path: 'FINANCE_PAYS_SUPPLIER' });
    const draft = await svc.awardPayments.awardDraft(env.as('selector'), requestId);
    expect(draft).toMatchObject({ shape: 'PREPAY', remainingToFund: '1000.00', blockers: [] });
    expect(draft.accounts.find((x) => x.bankAccountId === env.bank.mainBankId)?.underDualControl).toBe(true);

    const result = await pay(requestId);
    expect(result.awaiting).toBeUndefined();
    expect(result.payment).toMatchObject({ postingStatus: 'POSTED', documentStatus: 'APPROVED', shape: 'PREPAY', quotationRequestId: requestId });
    const { lines, entry } = await journalLines(prisma, result.payment.postedJournalEntryId!);
    expect(lines).toEqual([
      ['13000', '1000.00', '0.00'],
      ['10950', '0.00', '1000.00'],
    ]);
    expect(entry.accountingDate.toISOString().slice(0, 10)).toBe('2026-10-08');
    expect(await prisma.supplierPaymentPurchaseAllocation.count({ where: { purchaseOrderId: poId } })).toBe(1);
    const paid = await prisma.notification.findMany({ where: { resourceId: requestId, kind: 'SUPPLIER_PAID' }, select: { recipientUserId: true } });
    expect(paid.map((n) => n.recipientUserId)).toContain(env.userIds.collector);
    expect(await prisma.notification.count({ where: { resourceId: requestId, kind: 'PAYMENT_NEEDED', resolvedAt: null } })).toBe(0);
    const events = await prisma.auditOutboxEvent.findMany({ where: { aggregateId: result.payment.id }, select: { eventType: true } });
    expect(events.map((e) => e.eventType).sort()).toEqual(['SUPPLIER_PAID_FROM_AWARD', 'SUPPLIER_PAYMENT_CREATED_FROM_AWARD']);

    // R3 — nothing more than the order.
    expect(await refusal(pay(requestId, { amount: '0.01' }))).toEqual({ status: 409, code: 'FUNDING_EXCEEDS_ORDER' });

    // S9 — invoice photographed, goods received, recorded: EVT-AP-005 applies the prepayment.
    const doc = await invoice(poId);
    await a.receive(poId);
    const recorded = await svc.recordReceipt.record(env.payer2, {
      storeDocumentId: doc.id,
      total: '1000.00',
      documentDate: '2026-10-09',
      expenseProfileCode: env.postingProfileCode,
    });
    expect(recorded.step).toBe('DONE');
    expect(recorded.applied).toEqual([{ kind: 'SUPPLIER_PAYMENT', id: result.payment.id, amount: '1000.00' }]);
    expect(recorded.bill!.outstandingAmount).toBe('0.00');
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } })).status).toBe('CLOSED');
  });

  it('S10: pay the posted invoice (PAY_BILL) — Dr AP / Cr account; the bill approver cannot pay it', async () => {
    const { requestId, poId } = await a.awardedOrder({ path: 'FINANCE_PAYS_SUPPLIER' });
    const doc = await invoice(poId);
    await a.receive(poId);
    const recorded = await svc.recordReceipt.record(env.payer2, {
      storeDocumentId: doc.id,
      total: '1000.00',
      documentDate: '2026-10-08',
      expenseProfileCode: env.postingProfileCode,
    });
    expect(recorded.bill!.outstandingAmount).toBe('1000.00');
    const draft = await svc.awardPayments.awardDraft(env.as('selector'), requestId);
    expect(draft.shape).toBe('PAY_BILL');
    // payer2 approved the bill → cannot approve its payment (existing rule still fires).
    expect(await refusal(pay(requestId, { shape: 'PAY_BILL', supplierBillId: recorded.bill!.id }, env.payer2))).toEqual({
      status: 403,
      code: 'BILL_APPROVER_CANNOT_APPROVE_OR_RELEASE_PAYMENT',
    });
    const result = await pay(requestId, { shape: 'PAY_BILL', supplierBillId: recorded.bill!.id });
    expect((await journalLines(prisma, result.payment.postedJournalEntryId!)).lines).toEqual([
      ['AP-PROC', '1000.00', '0.00'],
      ['10950', '0.00', '1000.00'],
    ]);
    expect((await prisma.supplierBill.findUniqueOrThrow({ where: { id: recorded.bill!.id } })).outstandingAmount.toString()).toBe('0');
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } })).status).toBe('CLOSED');
  });

  it('S11: an account under dual control stops at APPROVED; two signatures, then the re-drive posts', async () => {
    const { requestId } = await a.awardedOrder({ path: 'FINANCE_PAYS_SUPPLIER' });
    const key = randomUUID();
    const first = await pay(requestId, { key, bankAccountId: env.bank.mainBankId });
    expect(first.awaiting).toBe('RELEASE_SIGNATURES');
    expect(first.payment).toMatchObject({ documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED' });
    await svc.payments.signRelease(env.as('cfo'), first.payment.id);
    await svc.payments.signRelease(env.as('director'), first.payment.id);
    const done = await pay(requestId, { key, bankAccountId: env.bank.mainBankId });
    expect(done.payment).toMatchObject({ id: first.payment.id, documentStatus: 'RELEASED', postingStatus: 'POSTED' });
    expect((await journalLines(prisma, done.payment.postedJournalEntryId!)).lines[1]).toEqual(['10100', '0.00', '1000.00']);
  });

  it('S13 / R2 / R13: double tap gives one payment; wrong path; the vendor maintainer cannot pay', async () => {
    const { requestId } = await a.awardedOrder({ path: 'FINANCE_PAYS_SUPPLIER' });
    const key = randomUUID();
    const [x, y] = await Promise.all([pay(requestId, { key, amount: '300.00' }), pay(requestId, { key, amount: '300.00' })]);
    expect(y.payment.id).toBe(x.payment.id);
    expect(await prisma.supplierPayment.count({ where: { quotationRequestId: requestId } })).toBe(1);

    const cash = await a.awardedOrder({ path: 'BUYER_CASH' });
    expect(await refusal(pay(cash.requestId))).toEqual({ status: 409, code: 'PAYMENT_PATH_MISMATCH' });
    expect(await refusal(a.release(requestId))).toEqual({ status: 409, code: 'PAYMENT_PATH_MISMATCH' });

    await prisma.supplier.update({ where: { id: env.supplierId }, data: { createdBy: env.userIds.selector } });
    try {
      const draft = await svc.awardPayments.awardDraft(env.as('selector'), requestId);
      expect(draft.supplier?.isVendorMaintainer).toBe(true);
      expect(draft.blockers).toContain('VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT');
      expect(await refusal(pay(requestId, { amount: '100.00' }))).toEqual({
        status: 403,
        code: 'VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT',
      });
      await expect(pay(requestId, { amount: '100.00' }, env.payer2)).resolves.toBeTruthy();
    } finally {
      await prisma.supplier.update({ where: { id: env.supplierId }, data: { createdBy: null } });
    }
  });

  describe('bands active', () => {
    beforeAll(() => a.setPaymentBandsActive(true));
    afterAll(() => a.setPaymentBandsActive(false));

    it('> $1k: the payer’s tap is the FO step; 409 until the CFO approves; the re-drive posts', async () => {
      const { requestId } = await a.awardedOrder({ total: '4000.00', path: 'FINANCE_PAYS_SUPPLIER' });
      const key = randomUUID();
      const gated = await pay(requestId, { key, amount: '4000.00' }).catch((e) => e);
      expect(gated.getStatus()).toBe(409);
      const { approvalInstanceId } = gated.getResponse().details;
      await svc.approvals.approve(approvalInstanceId, env.userIds.cfo, ['CFO'], env.orgId);
      const done = await pay(requestId, { key, amount: '4000.00' });
      expect(done.payment).toMatchObject({ postingStatus: 'POSTED', approvedBy: env.userIds.cfo });
    });
  });
});
