import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { activateSodRules } from '../../../procurement/__tests__/helpers/governance-fixture.js';
import { awardSteps } from './helpers/award-steps.js';
import { buildPaymentServices, type PaymentServices } from './helpers/build-payment-services.js';
import { cleanupPaymentEnv, createPaymentEnv, type PaymentTestEnv } from './helpers/payment-fixture.js';

/**
 * ADR-045 P9 (live DB) — the payment notifications + WhatsApp purposes: PAYMENT_NEEDED once per
 * payer on the award order's confirm, CASH_RELEASED to the recipient, no amount in any template
 * parameter (product owner Q2), the guard withdraws a stale pay-needed alert, the kill switch.
 */
describe('ADR-045 P9 — payment notifications and WhatsApp', () => {
  const prisma = new PrismaClient();
  let env: PaymentTestEnv;
  let svc: PaymentServices;
  let a: ReturnType<typeof awardSteps>;

  const messages = (requestId: string, purpose?: string) =>
    prisma.outboundMessage.findMany({
      where: { resourceType: 'quotation_request', resourceId: requestId, ...(purpose ? { purpose: purpose as never } : {}) },
      orderBy: { queuedAt: 'asc' },
    });
  const onlyDue = (requestId: string) =>
    prisma.outboundMessage.updateMany({
      where: { status: 'QUEUED', nextAttemptAt: { not: null }, NOT: { resourceId: requestId } },
      data: { nextAttemptAt: new Date('2999-01-01') },
    });
  /** No parameter looks like an amount ("1000", "1,000.00", "USD …"). */
  const noAmount = (params: unknown) => {
    const body = ((params as { body: string[] }).body ?? []).join(' | ');
    expect(body).not.toMatch(/\b1[,.]?000\b|\d+\.\d{2}\b|USD/);
  };

  beforeAll(async () => {
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    env = await createPaymentEnv(prisma);
    svc = buildPaymentServices(prisma, { env: { QUOTATION_WHATSAPP_ENABLED: 'true' } });
    a = awardSteps(prisma, env, svc);
    await activateSodRules(prisma, env.orgId, ['QUOTE_UPLOADER_CANNOT_SELECT', 'REQUESTER_CANNOT_SELECT']);
    for (const [persona, phone] of [['selector', '+252612000101'], ['collector', '+252612000103']] as const) {
      await prisma.user.update({ where: { id: env.userIds[persona] }, data: { whatsappPhone: phone, whatsappAlertsEnabled: true } });
    }
  });

  afterAll(async () => {
    await cleanupPaymentEnv(prisma, env);
    await prisma.$disconnect();
  });

  it('S1: the award order issued → PAYMENT_NEEDED + QUOTE_PAY_NEEDED to the payer, once, no amount', async () => {
    const { requestId } = await a.awardedOrder();
    const inApp = await prisma.notification.findMany({ where: { resourceId: requestId, kind: 'PAYMENT_NEEDED' } });
    expect(inApp.map((n) => n.recipientUserId)).toEqual([env.userIds.selector]);
    const wa = await messages(requestId, 'QUOTE_PAY_NEEDED');
    expect(wa.map((m) => m.recipientUserId)).toEqual([env.userIds.selector]);
    expect(wa[0].templateName).toBe('quote_pay_needed_so');
    noAmount(wa[0].templateParams);
    expect((wa[0].templateParams as { body: string[] }).body[3]).toBe('Iibsaduhu kaash ayuu bixinayaa');
  });

  it('cash released → CASH_RELEASED to the buyer (no amount); the stale pay-needed alert is withdrawn at dispatch', async () => {
    const { requestId } = await a.awardedOrder();
    const { advance } = await a.release(requestId);
    const inApp = await prisma.notification.findMany({ where: { resourceId: requestId, kind: 'CASH_RELEASED' } });
    expect(inApp.map((n) => n.recipientUserId)).toEqual([env.userIds.collector]);
    expect(JSON.stringify(inApp[0].contextData)).not.toMatch(/1000/);
    expect(await prisma.notification.count({ where: { resourceId: requestId, kind: 'PAYMENT_NEEDED', resolvedAt: null } })).toBe(0);
    const cash = await messages(requestId, 'QUOTE_CASH_RELEASED');
    expect(cash.map((m) => [m.recipientUserId, m.idempotencyKey.split(':')[3]])).toEqual([[env.userIds.collector, advance.id]]);
    noAmount(cash[0].templateParams);

    await onlyDue(requestId);
    await svc.communication.dispatchDue(new Date());
    const [payNeeded] = await messages(requestId, 'QUOTE_PAY_NEEDED');
    expect(payNeeded).toMatchObject({ status: 'FAILED', errorCode: 'NOT_NEEDED' });
    expect((await messages(requestId, 'QUOTE_CASH_RELEASED'))[0].status).toBe('SENT');
    const detail = await svc.query.detail(env.as('collector'), requestId);
    expect(detail.messages.map((m) => m.purpose)).toEqual(expect.arrayContaining(['QUOTE_PAY_NEEDED', 'QUOTE_CASH_RELEASED']));
    expect(detail.messages.find((m) => m.purpose === 'QUOTE_PAY_NEEDED')?.failureReason).toBe('Not sent: the order is already being paid.');
  });

  it('the kill switch off → nothing queued (in-app still written)', async () => {
    const off = buildPaymentServices(prisma, { env: {} });
    const steps = awardSteps(prisma, env, off);
    const { requestId } = await steps.awardedOrder();
    await steps.release(requestId);
    expect(await messages(requestId)).toHaveLength(0);
    expect(await prisma.notification.count({ where: { resourceId: requestId, kind: 'CASH_RELEASED' } })).toBe(1);
  });
});
