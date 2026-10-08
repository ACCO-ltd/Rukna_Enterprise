import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { activateSodRules } from '../../../procurement/__tests__/helpers/governance-fixture.js';
import { createUploadedPhoto } from '../../../procurement/quotations/__tests__/helpers/quotation-fixture.js';
import { refusal } from '../../../procurement/quotations/__tests__/helpers/quotation-steps.js';
import { awardSteps } from './helpers/award-steps.js';
import { buildPaymentServices, type PaymentServices } from './helpers/build-payment-services.js';
import { cleanupPaymentEnv, createPaymentEnv, type PaymentTestEnv } from './helpers/payment-fixture.js';

/**
 * ADR-045 P8 (live DB) — the request's `payment` block through the BUYER_CASH journey, money
 * hidden from money-blind viewers, allowedActions reasons, path change (S12 / R14), the finance
 * queues, and legacy advances in the settlement read model.
 */
describe('ADR-045 P8 — payment read model, path change, queues', () => {
  const prisma = new PrismaClient();
  let env: PaymentTestEnv;
  let svc: PaymentServices;
  let a: ReturnType<typeof awardSteps>;

  beforeAll(async () => {
    env = await createPaymentEnv(prisma);
    svc = buildPaymentServices(prisma);
    a = awardSteps(prisma, env, svc);
    await activateSodRules(prisma, env.orgId, ['QUOTE_UPLOADER_CANNOT_SELECT', 'REQUESTER_CANNOT_SELECT', 'GOODS_RECEIVER_CANNOT_APPROVE_BILL']);
  });

  afterAll(async () => {
    await cleanupPaymentEnv(prisma, env);
    await prisma.$disconnect();
  });

  const paymentOf = async (requestId: string, as = env.as('selector')) => (await svc.query.detail(as, requestId)).payment!;
  const action = (p: Awaited<ReturnType<typeof paymentOf>>, name: string) => p.allowedActions.find((x) => x.action === name);

  it('BUYER_CASH journey: READY_TO_PAY → CASH_WITH_BUYER → WAITING_FOR_GOODS → RECEIPT_TO_RECORD → SETTLING → SETTLED', async () => {
    const { requestId, poId } = await a.awardedOrder();
    let p = await paymentOf(requestId);
    expect(p).toMatchObject({ path: 'BUYER_CASH', state: 'READY_TO_PAY', orderedAmount: '1000.00', funded: '0.00', remainingToFund: '1000.00' });
    expect(action(p, 'RELEASE_CASH')).toEqual({ action: 'RELEASE_CASH', enabled: true });
    expect(action(p, 'CHANGE_PATH')?.enabled).toBe(true);

    const { advance, payment } = await a.release(requestId);
    expect(payment).toMatchObject({ state: 'CASH_WITH_BUYER', withBuyer: '1000.00' });
    p = await paymentOf(requestId);
    expect(action(p, 'CHANGE_PATH')).toEqual({ action: 'CHANGE_PATH', enabled: false, reason: 'PAYMENT_PATH_LOCKED' });
    expect(p.advances?.[0]).toMatchObject({ id: advance.id, amount: '1000.00', outstanding: '1000.00', legacy: false });

    const file = await createUploadedPhoto(prisma, env, 'collector');
    const doc = await svc.storeDocuments.create(env.as('collector'), {
      clientRef: randomUUID(),
      purchaseOrderId: poId,
      kind: 'RECEIPT',
      photos: [{ platformFileId: file.id, capturedAt: '2026-10-08T10:42:00.000Z', source: 'CAMERA' }],
    });
    p = await paymentOf(requestId);
    expect(p.state).toBe('WAITING_FOR_GOODS');
    expect(action(p, 'RECORD_RECEIPT')).toEqual({ action: 'RECORD_RECEIPT', enabled: false, reason: 'GOODS_NOT_RECEIVED' });

    await a.receive(poId);
    p = await paymentOf(requestId);
    expect(p.state).toBe('RECEIPT_TO_RECORD');
    expect(action(p, 'RECORD_RECEIPT')?.enabled).toBe(true);

    // The settle queue lists it (a receipt waits); the pay queue does not (fully funded).
    const settle = await svc.lists.list(env.as('selector'), { queue: 'settle' });
    expect(settle.items.map((x) => x.id)).toContain(requestId);
    const pay = await svc.lists.list(env.as('selector'), { queue: 'pay' });
    expect(pay.items.map((x) => x.id)).not.toContain(requestId);

    await svc.recordReceipt.record(env.payer2, { storeDocumentId: doc.id, total: '980.00', documentDate: '2026-10-08', expenseProfileCode: env.postingProfileCode });
    p = await paymentOf(requestId);
    expect(p).toMatchObject({ state: 'SETTLING', withBuyer: '20.00' });
    expect(action(p, 'RECORD_RETURN')?.enabled).toBe(true);

    await svc.advances.createReturn(env.payer2, advance.id, {
      amount: '20.00',
      returnMethod: 'CASH',
      destinationBankAccountId: env.bank.cashBoxId,
      receivedBy: env.payer2.userId,
      receivedAt: '2026-10-09',
    });
    p = await paymentOf(requestId);
    expect(p.state).toBe('SETTLED');

    // Procurement's bill payment status: paid by the buyer's cash.
    const bills = await svc.settlement.getBillPayments(env.as('selector'), poId);
    expect(bills.bills[0]).toMatchObject({ paymentStatus: 'PAID_BY_BUYER_CASH', paidAmount: '980.00', paidByBuyerCashAmount: '980.00' });
  });

  it('money is null for a money-blind viewer; the pay queue is for finance only', async () => {
    const { requestId } = await a.awardedOrder();
    const p = await paymentOf(requestId, env.as('pm'));
    expect(p).toMatchObject({ orderedAmount: null, funded: null, remainingToFund: null, withBuyer: null, advances: null, payments: null, moneyVisible: false });
    expect(action(p, 'RELEASE_CASH')).toEqual({ action: 'RELEASE_CASH', enabled: false, reason: 'MISSING_PERMISSION' });
    const pay = await svc.lists.list(env.as('selector'), { queue: 'pay' });
    expect(pay.items.map((x) => x.id)).toContain(requestId);
    expect(pay.items.find((x) => x.id === requestId)).toHaveProperty('paymentWaitingWorkingMinutes');
    expect(await refusal(svc.lists.list(env.as('collector'), { queue: 'pay' }))).toEqual({ status: 403, code: 'MISSING_PERMISSION' });
  });

  it('S12 / R14: the path changes (with a reason) before any money moved, PAYMENT_NEEDED re-targeted; then it is locked', async () => {
    const { requestId } = await a.awardedOrder();
    const changed = await svc.paymentPath.changePaymentPath(env.as('selector'), requestId, { paymentPath: 'FINANCE_PAYS_SUPPLIER', reason: 'Store will not take cash' });
    expect(changed.payment).toMatchObject({ path: 'FINANCE_PAYS_SUPPLIER', state: 'READY_TO_PAY' });
    const needed = await prisma.notification.findMany({ where: { resourceId: requestId, kind: 'PAYMENT_NEEDED' }, select: { dedupeKey: true, resolvedAt: true } });
    expect(needed.filter((n) => n.resolvedAt === null).map((n) => n.dedupeKey)).toEqual([expect.stringMatching(/FINANCE_PAYS_SUPPLIER$/)]);
    const events = await prisma.auditOutboxEvent.findMany({ where: { aggregateId: requestId, eventType: 'QUOTATION_PAYMENT_PATH_CHANGED' } });
    expect(events).toHaveLength(1);

    await svc.awardPayments.payFromAward(env.as('selector'), {
      idempotencyKey: randomUUID(),
      quotationRequestId: requestId,
      bankAccountId: env.bank.evcId,
      paymentMethod: 'MOBILE_MONEY',
      paymentDate: '2026-10-08',
      amount: '100.00',
      shape: 'PREPAY',
    });
    expect(
      await refusal(svc.paymentPath.changePaymentPath(env.as('selector'), requestId, { paymentPath: 'BUYER_CASH', reason: 'back' })),
    ).toEqual({ status: 409, code: 'PAYMENT_PATH_LOCKED' });
  });

  it('buyer-cash readiness: STAFF_ADVANCE in force + the accounts without signatories', async () => {
    const r = await svc.advances.readiness(env.as('selector'));
    expect(r).toMatchObject({ ready: true, staffAdvanceProfile: true, cashAccountsWithoutSignatories: 2 });
    expect(r.cashAccounts.map((x) => x.bankAccountId).sort()).toEqual([env.bank.cashBoxId, env.bank.evcId].sort());
  });

  it('a legacy advance is labelled in the settlement and keeps its arithmetic', async () => {
    const { poId } = await a.awardedOrder();
    await prisma.buyerAdvance.create({
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
        createdBy: env.userIds.selector,
      },
    });
    const s = await svc.settlement.getSettlement(env.as('selector'), poId);
    expect(s.advanceFunding.advances[0]).toMatchObject({ legacy: true, label: 'Recorded before GL posting' });
    expect(s.advanceFunding.advances[0].outstanding.toFixed(2)).toBe('300.00');
    expect(s.advanceFunding.totalAdvanced.toFixed(2)).toBe('300.00');
  });
});
