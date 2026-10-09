import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { activateSodRules } from '../../../procurement/__tests__/helpers/governance-fixture.js';
import { createUploadedPhoto } from '../../../procurement/quotations/__tests__/helpers/quotation-fixture.js';
import { refusal } from '../../../procurement/quotations/__tests__/helpers/quotation-steps.js';
import { awardSteps } from './helpers/award-steps.js';
import { buildPaymentServices, type PaymentServices } from './helpers/build-payment-services.js';
import { balances, cleanupPaymentEnv, createPaymentEnv, journalLines, type PaymentTestEnv } from './helpers/payment-fixture.js';

/**
 * ADR-045 P6 (live DB) — record the store receipt into the bill and settle it from the buyer's
 * cash (EVT-AP-008); change returned closes the order; top-up; price exception; resume; mismatches.
 */
describe('ADR-045 P6 — record receipt → bill → settle', () => {
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
      'GOODS_RECEIVER_CANNOT_APPROVE_BILL',
      'PO_CREATOR_CANNOT_RECEIVE_GOODS',
    ]);
  });

  afterAll(async () => {
    await cleanupPaymentEnv(prisma, env);
    await prisma.$disconnect();
  });

  async function receipt(poId: string, kind: 'RECEIPT' | 'INVOICE' = 'RECEIPT') {
    const file = await createUploadedPhoto(prisma, env, 'collector');
    return svc.storeDocuments.create(env.as('collector'), {
      clientRef: randomUUID(),
      purchaseOrderId: poId,
      kind,
      photos: [{ platformFileId: file.id, capturedAt: '2026-10-08T10:42:00.000Z', source: 'CAMERA' }],
    });
  }

  const record = (storeDocumentId: string, total?: string, as = env.payer2) =>
    svc.recordReceipt.record(as, {
      storeDocumentId,
      ...(total ? { total, documentDate: '2026-10-08', expenseProfileCode: env.postingProfileCode } : {}),
    });

  it('S5 + S6: record 980 of 1,000 → bill posted, 980 applied (EVT-AP-008); 20 change returned → order settled and closed', async () => {
    const { requestId, poId } = await a.awardedOrder();
    const before = await balances(prisma, env.orgId);
    const { advance } = await a.release(requestId);
    const doc = await receipt(poId);
    await a.receive(poId);

    const result = await record(doc.id, '980.00');
    expect(result.step).toBe('DONE');
    expect(result.storeDocument.status).toBe('RECORDED');
    expect(result.bill).toMatchObject({ postingStatus: 'POSTED', totalAmount: '980.00', outstandingAmount: '0.00', supplierInvoiceNumber: doc.number });
    expect(result.applied).toEqual([{ kind: 'BUYER_ADVANCE', id: advance.id, amount: '980.00' }]);

    const bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id: result.bill!.id } });
    expect(bill.billDate.toISOString().slice(0, 10)).toBe('2026-10-08');
    expect(['MATCHED', 'MATCHED_WITH_TOLERANCE']).toContain(bill.matchStatus);
    const billJournal = await journalLines(prisma, bill.postedJournalEntryId!);
    expect(billJournal.lines).toEqual([
      ['EXP-PROC', '980.00', '0.00'],
      ['AP-PROC', '0.00', '980.00'],
    ]);
    const app = await prisma.buyerAdvanceEvidenceAllocation.findFirstOrThrow({ where: { buyerAdvanceId: advance.id } });
    expect(app).toMatchObject({ postingStatus: 'POSTED' });
    expect(app.allocationDate!.toISOString().slice(0, 10)).toBe('2026-10-08');
    const appJournal = await journalLines(prisma, app.journalEntryId!);
    expect(appJournal.lines).toEqual([
      ['AP-PROC', '980.00', '0.00'],
      ['13100', '0.00', '980.00'],
    ]);
    expect(appJournal.entry.accountingEventId).toBe('EVT-AP-008');
    const files = await prisma.platformFile.findMany({ where: { id: { in: doc.photos.map((p) => p.fileId) } } });
    expect(files.every((f) => f.lifecycle === 'IMMUTABLE')).toBe(true);
    expect((await svc.advances.findById(env.payer2, advance.id)).outstanding.toFixed(2)).toBe('20.00');
    expect(await prisma.notification.count({ where: { resourceId: doc.id, kind: 'RECEIPT_TO_RECORD', resolvedAt: null } })).toBe(0);

    // S6 — change returned.
    await svc.advances.createReturn(env.payer2, advance.id, {
      amount: '20.00',
      returnMethod: 'CASH',
      destinationBankAccountId: env.bank.cashBoxId,
      receivedBy: env.payer2.userId,
      receivedAt: '2026-10-09',
    });
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } })).status).toBe('CLOSED');

    // The GL nets: staff advances back to where they were, the cash box down by what was spent,
    // AP for this purchase zero, the expense 980.
    const after = await balances(prisma, env.orgId);
    const delta = (code: string) => (Number(after[code] ?? 0) - Number(before[code] ?? 0)).toFixed(2);
    expect(delta('13100')).toBe('0.00');
    expect(delta('10900')).toBe('-980.00');
    expect(delta('AP-PROC')).toBe('0.00');
    expect(delta('EXP-PROC')).toBe('980.00');

    // Review LOW — reversing the application reopens the order auto-closed as settled.
    await svc.advances.reverseApplication(env.payer2, advance.id, app.id, 'wrong receipt amount');
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } })).status).toBe('OPEN');
  });

  it('review LOW: a receipt cannot be recorded against an order that is not OPEN', async () => {
    const { requestId, poId } = await a.awardedOrder();
    await a.release(requestId);
    const doc = await receipt(poId);
    await a.receive(poId);
    await prisma.purchaseOrder.update({ where: { id: poId }, data: { status: 'CANCELLED' } });
    try {
      expect(await refusal(record(doc.id, '1000.00'))).toEqual({ status: 409, code: 'PAYMENT_PO_NOT_OPEN' });
    } finally {
      await prisma.purchaseOrder.update({ where: { id: poId }, data: { status: 'OPEN' } });
    }
  });

  it('S7: shortfall — 1,030 receipt on 1,030 order with 1,000 released; top-up 30 applies to the bill', async () => {
    const { requestId, poId } = await a.awardedOrder({ total: '1030.00' });
    await a.release(requestId, { amount: '1000.00' });
    const doc = await receipt(poId);
    await a.receive(poId);
    const result = await record(doc.id, '1030.00');
    expect(result.bill!.outstandingAmount).toBe('30.00');
    expect(await refusal(a.release(requestId, { amount: '30.01', applyToBillId: result.bill!.id }))).toEqual({
      status: 409,
      code: 'FUNDING_EXCEEDS_ORDER',
    });
    const topUp = await a.release(requestId, { amount: '30.00', applyToBillId: result.bill!.id });
    expect(topUp.advance.outstanding.toFixed(2)).toBe('0.00');
    expect((await prisma.supplierBill.findUniqueOrThrow({ where: { id: result.bill!.id } })).outstandingAmount.toString()).toBe('0');
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } })).status).toBe('CLOSED');
  });

  it('R9: before a posted goods receipt the receipt cannot be recorded — nothing is created', async () => {
    const { requestId, poId } = await a.awardedOrder();
    await a.release(requestId);
    const doc = await receipt(poId);
    expect(await refusal(record(doc.id, '980.00'))).toEqual({ status: 409, code: 'GOODS_NOT_RECEIVED' });
    expect(await prisma.supplierBill.count({ where: { purchaseOrderId: poId } })).toBe(0);
  });

  it('R10: above the order → MATCH_EXCEPTION; CFO approves the exception; resume settles; top-up up to the bill (Q3)', async () => {
    const { requestId, poId } = await a.awardedOrder();
    await a.release(requestId);
    const doc = await receipt(poId);
    await a.receive(poId);
    const stopped = await record(doc.id, '1100.00');
    expect(stopped.step).toBe('MATCH_EXCEPTION');
    expect(stopped.storeDocument.status).toBe('SUBMITTED');
    expect(stopped.bill).toMatchObject({ documentStatus: 'SUBMITTED', matchStatus: 'EXCEPTION' });
    // Before the exception is approved, nothing above the order can be released.
    expect(await refusal(a.release(requestId, { amount: '100.00' }))).toEqual({ status: 409, code: 'FUNDING_EXCEEDS_ORDER' });

    await svc.billMatching.approveException(env.as('cfo'), stopped.bill!.id, { approvalReason: 'Steel price rose at the counter' });
    const resumed = await record(doc.id);
    expect(resumed.step).toBe('DONE');
    expect(resumed.bill).toMatchObject({ postingStatus: 'POSTED', outstandingAmount: '100.00' });
    // Once the price exception is approved (bill posted at 1,100) the buyer can be reimbursed to it.
    await a.release(requestId, { amount: '100.00', applyToBillId: stopped.bill!.id });
    expect((await prisma.supplierBill.findUniqueOrThrow({ where: { id: stopped.bill!.id } })).outstandingAmount.toString()).toBe('0');
  });

  it('a re-tap after a failure between steps completes without a second bill', async () => {
    const { requestId, poId } = await a.awardedOrder();
    await a.release(requestId);
    const doc = await receipt(poId);
    await a.receive(poId);
    // The receiver cannot approve the bill (SoD): steps 1–2 done, step 3 refused.
    expect(await refusal(record(doc.id, '1000.00', env.receiver))).toMatchObject({ status: 403 });
    const bills = await prisma.supplierBill.findMany({ where: { purchaseOrderId: poId } });
    expect(bills).toHaveLength(1);
    expect(bills[0].documentStatus).toBe('SUBMITTED');
    const done = await record(doc.id);
    expect(done.step).toBe('DONE');
    expect(await prisma.supplierBill.count({ where: { purchaseOrderId: poId } })).toBe(1);
    expect(done.applied.map((x) => x.amount)).toEqual(['1000.00']);
  });

  it('R11: an application to another order’s bill, or above an outstanding, is refused', async () => {
    const one = await a.awardedOrder();
    const two = await a.awardedOrder();
    const { advance } = await a.release(one.requestId, { amount: '500.00' });
    await a.release(two.requestId);
    const doc = await receipt(two.poId);
    await a.receive(two.poId);
    const rec = await record(doc.id, '1000.00');
    expect(await refusal(svc.advances.createApplication(env.payer2, advance.id, { supplierBillId: rec.bill!.id }))).toEqual({
      status: 422,
      code: 'APPLICATION_MISMATCH',
    });
    // Reverse the application on the second order: the bill opens again, on the application date.
    const app = await prisma.buyerAdvanceEvidenceAllocation.findFirstOrThrow({ where: { supplierBillId: rec.bill!.id } });
    const reversed = await svc.advances.reverseApplication(env.payer2, app.buyerAdvanceId, app.id, 'wrong receipt');
    const { entry } = await journalLines(prisma, reversed.reversalJournalEntryId);
    expect(entry.accountingDate.toISOString().slice(0, 10)).toBe('2026-10-08');
    expect((await prisma.supplierBill.findUniqueOrThrow({ where: { id: rec.bill!.id } })).outstandingAmount.toString()).toBe('1000');
    expect(
      await refusal(svc.advances.createApplication(env.payer2, app.buyerAdvanceId, { supplierBillId: rec.bill!.id, amount: '1000.01' })),
    ).toEqual({ status: 422, code: 'APPLICATION_EXCEEDS_OUTSTANDING' });
    await svc.advances.createApplication(env.payer2, app.buyerAdvanceId, { supplierBillId: rec.bill!.id });
    expect((await prisma.supplierBill.findUniqueOrThrow({ where: { id: rec.bill!.id } })).outstandingAmount.toString()).toBe('0');
  });

  it('item 5: an application replay with its key returns the first application; a different body is refused', async () => {
    const { requestId, poId } = await a.awardedOrder();
    const { advance } = await a.release(requestId, { amount: '1000.00' });
    const doc = await receipt(poId);
    await a.receive(poId);
    const rec = await record(doc.id, '1000.00');
    const app = await prisma.buyerAdvanceEvidenceAllocation.findFirstOrThrow({ where: { supplierBillId: rec.bill!.id } });
    await svc.advances.reverseApplication(env.payer2, advance.id, app.id, 'redo with a key');
    const key = 'app-key-' + doc.id;
    const first = await svc.advances.createApplication(env.payer2, advance.id, { idempotencyKey: key, supplierBillId: rec.bill!.id, amount: '400.00' });
    const again = await svc.advances.createApplication(env.payer2, advance.id, { idempotencyKey: key, supplierBillId: rec.bill!.id, amount: '400.00' });
    expect(again.application.id).toBe(first.application.id);
    expect(await prisma.buyerAdvanceEvidenceAllocation.count({ where: { supplierBillId: rec.bill!.id, postingStatus: 'POSTED' } })).toBe(1);
    expect(
      await refusal(svc.advances.createApplication(env.payer2, advance.id, { idempotencyKey: key, supplierBillId: rec.bill!.id, amount: '401.00' })),
    ).toEqual({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  describe('QA A - paying less than the order at the counter', () => {
    it('540 on a 580 order (>2% under) settles; the change is returned and the order closes', async () => {
      const { requestId, poId } = await a.awardedOrder({ total: '580.00' });
      const { advance } = await a.release(requestId, { amount: '580.00' });
      const doc = await receipt(poId);
      await a.receive(poId);
      const result = await record(doc.id, '540.00');
      expect(result.step).toBe('DONE');
      expect(result.exception).toBeNull();
      expect(result.bill).toMatchObject({ postingStatus: 'POSTED', outstandingAmount: '0.00' });
      await svc.advances.createReturn(env.payer2, advance.id, {
        amount: '40.00',
        returnMethod: 'CASH',
        destinationBankAccountId: env.bank.cashBoxId,
        receivedBy: env.payer2.userId,
        receivedAt: '2026-10-09',
      });
      expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } })).status).toBe('CLOSED');
    });

    it('640 on a 580 order is still a price exception, reported as above the order', async () => {
      const { requestId, poId } = await a.awardedOrder({ total: '580.00' });
      await a.release(requestId, { amount: '580.00' });
      const doc = await receipt(poId);
      await a.receive(poId);
      const result = await record(doc.id, '640.00');
      expect(result.step).toBe('MATCH_EXCEPTION');
      expect(result.exception).toEqual({ kind: 'ABOVE_ORDER' });
    });

    it('an ordinary PO bill below the order price keeps the existing exception (ACCO A2)', async () => {
      const { poId } = await a.awardedOrder({ total: '580.00', path: 'FINANCE_PAYS_SUPPLIER' });
      await a.receive(poId);
      const lines = await a.poLines(poId);
      const bill = await svc.bills.create(env.payer2, {
        supplierId: env.supplierId,
        supplierInvoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
        billDate: '2026-10-08',
        dueDate: '2026-10-08',
        currencyCode: 'USD',
        purchaseOrderId: poId,
        lines: [{ description: lines[0].description, quantity: 10, unitPrice: 54, netAmount: 540, vatAmount: 0, expenseProfileCode: env.postingProfileCode }],
      });
      await svc.bills.submit(env.payer2, bill.id);
      expect((await prisma.supplierBill.findUniqueOrThrow({ where: { id: bill.id } })).matchStatus).toBe('EXCEPTION');
    });
  });
});
