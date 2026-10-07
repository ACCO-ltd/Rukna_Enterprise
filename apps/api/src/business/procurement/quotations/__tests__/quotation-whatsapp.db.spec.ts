import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { activateSodRules } from '../../__tests__/helpers/governance-fixture.js';
import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import {
  cleanupQuotationEnv,
  createApprovedMr,
  createQuotationEnv,
  type Persona,
  type QuotationTestEnv,
} from './helpers/quotation-fixture.js';
import { steps } from './helpers/quotation-steps.js';
import { decisionRound } from '../domain/quotation-whatsapp.policy.js';

/**
 * ADR-044 phase 2 (live DB) — WhatsApp alerts to staff for quotation events and the SLA chaser.
 *
 * Phones: selector + selector2 (CEO) + requester (an award holder the SoD bars) + collector opted
 * in; cfo (CFO) has a number but alerts OFF; collector2 has no number.
 */
describe('ADR-044 phase 2 — quotation WhatsApp alerts', () => {
  const prisma = new PrismaClient();
  let env: QuotationTestEnv;
  let svc: QuotationServices;
  let s: ReturnType<typeof steps>;

  const PHONES: Partial<Record<Persona, { phone: string; on: boolean }>> = {
    selector: { phone: '+252612000001', on: true },
    selector2: { phone: '+252612000002', on: true },
    requester: { phone: '+252612000004', on: true },
    collector: { phone: '+252612000003', on: true },
    cfo: { phone: '+252612000005', on: false },
  };

  const alerts = (requestId: string, purpose?: string) =>
    prisma.outboundMessage.findMany({
      where: { resourceType: 'quotation_request', resourceId: requestId, ...(purpose ? { purpose: purpose as never } : {}) },
      orderBy: [{ queuedAt: 'asc' }, { recipient: 'asc' }],
    });
  const recipientsOf = async (requestId: string, purpose: string) =>
    (await alerts(requestId, purpose)).map((m) => m.recipientUserId).sort();
  const ids = (...personas: Persona[]) => personas.map((p) => env.userIds[p]).sort();

  beforeAll(async () => {
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    env = await createQuotationEnv(prisma);
    svc = buildQuotationServices(prisma, { env: { QUOTATION_WHATSAPP_ENABLED: 'true' } });
    s = steps(prisma, env, svc);
    await activateSodRules(prisma, env.orgId, ['QUOTE_UPLOADER_CANNOT_SELECT', 'REQUESTER_CANNOT_SELECT']);
    // The MR requester also holds award:quotation — SoD bars them, so no alert either.
    const award = await prisma.permission.findUniqueOrThrow({ where: { action_resource: { action: 'award', resource: 'quotation' } } });
    const requesterRole = await prisma.role.findFirstOrThrow({ where: { organizationId: env.orgId, name: 'requester-role' } });
    await prisma.rolePermission.create({ data: { roleId: requesterRole.id, permissionId: award.id } });
    // Escalation audience is by role NAME: give cfo the 'CFO' role and selector2 the 'CEO' role.
    for (const [persona, name] of [['cfo', 'CFO'], ['selector2', 'CEO']] as const) {
      const role = await prisma.role.create({ data: { organizationId: env.orgId, name, description: name } });
      const membership = await prisma.organizationMembership.findFirstOrThrow({ where: { organizationId: env.orgId, userId: env.userIds[persona] } });
      await prisma.organizationMembershipRole.create({ data: { membershipId: membership.id, roleId: role.id, assignedBy: env.userIds[persona] } });
    }
    for (const [persona, p] of Object.entries(PHONES)) {
      await prisma.user.update({
        where: { id: env.userIds[persona as Persona] },
        data: { whatsappPhone: p!.phone, whatsappAlertsEnabled: p!.on },
      });
    }
  });

  afterAll(async () => {
    await cleanupQuotationEnv(prisma, env);
    await prisma.$disconnect();
  });

  it('send → QUOTE_READY to opted-in selectors only (SoD-barred, alerts-off excluded), no money, deep-link suffix', async () => {
    const mr = await createApprovedMr(prisma, env);
    const request = await s.collected(mr.id);
    await svc.collect.send(env.as('collector'), request.id);
    const sent = await prisma.quotationRequest.findUniqueOrThrow({ where: { id: request.id } });

    const ready = await alerts(request.id, 'QUOTE_READY');
    expect(ready.map((m) => m.recipientUserId).sort()).toEqual(ids('selector', 'selector2'));
    for (const m of ready) {
      expect(m).toMatchObject({
        channel: 'WHATSAPP',
        status: 'QUEUED',
        templateName: 'quote_ready_so',
        templateLanguage: 'en',
        createdBy: env.userIds.collector,
        idempotencyKey: `quotation-wa:${request.id}:QUOTE_READY:${decisionRound(sent)}:${m.recipientUserId}`,
      });
      expect(m.templateParams).toEqual({ body: [request.number, mr.mrNumber, 'Test Site', '3'], buttonUrlSuffix: request.id });
      expect(m.nextAttemptAt).not.toBeNull();
    }
    // Same round again (e.g. a withdrawn award) → nothing new.
    const again = await prisma.$transaction((tx) =>
      svc.alerts.queue(tx, {
        organizationId: env.orgId,
        requestId: request.id,
        purpose: 'QUOTE_READY',
        round: decisionRound(sent),
        recipientUserIds: ids('selector', 'selector2'),
        facts: { number: request.number, mrNumber: mr.mrNumber, quoteCount: 3 },
        actorUserId: env.userIds.collector,
      }),
    );
    expect(again).toBe(0);
  });

  it('kill switch off, or WhatsApp not configured → nothing queued; the action and in-app are unaffected', async () => {
    for (const options of [{ env: {} }, { env: { QUOTATION_WHATSAPP_ENABLED: 'true' }, whatsappConfigured: false }]) {
      const off = buildQuotationServices(prisma, options);
      const mr = await createApprovedMr(prisma, env);
      const request = await steps(prisma, env, off).collected(mr.id);
      await off.collect.send(env.as('collector'), request.id);
      expect(await alerts(request.id)).toHaveLength(0);
      expect(await prisma.notification.count({ where: { resourceId: request.id, kind: 'QUOTES_READY' } })).toBeGreaterThan(0);
    }
  });

  it('a failing alert insert never blocks the send (savepoint)', async () => {
    const mr = await createApprovedMr(prisma, env);
    const request = await s.collected(mr.id);
    const repo = (svc.alerts as unknown as { messages: { enqueueMany: (...a: unknown[]) => Promise<number> } }).messages;
    const original = repo.enqueueMany;
    repo.enqueueMany = async (tx: unknown) => {
      await (tx as PrismaClient).$executeRawUnsafe('SELECT 1/0'); // a real database error inside the tx
      return 0;
    };
    try {
      const detail = await svc.collect.send(env.as('collector'), request.id);
      expect(detail.status).toBe('AWAITING_DECISION');
    } finally {
      repo.enqueueMany = original;
    }
    expect(await alerts(request.id)).toHaveLength(0);
    expect(await prisma.notification.count({ where: { resourceId: request.id, kind: 'QUOTES_READY' } })).toBeGreaterThan(0);
  });

  it('ask-another → QUOTE_ANOTHER to opted-in collectors with the note sanitised; the re-send is a new READY round', async () => {
    const mr = await createApprovedMr(prisma, env);
    const request = await s.collected(mr.id, ['Hodan']);
    await s.addQuote(request.id, { storeName: 'Bakaara' }, { persona: 'collector2' });
    await svc.collect.send(env.as('collector'), request.id, 'URGENT');
    await svc.selection.askAnother(env.as('selector'), request.id, 'Check Xamar Steel\ntoo,    please');

    const another = await alerts(request.id, 'QUOTE_ANOTHER');
    expect(another.map((m) => m.recipientUserId)).toEqual([env.userIds.collector]); // collector2 has no number
    expect(another[0]).toMatchObject({ templateName: 'quote_another_so', createdBy: env.userIds.selector });
    expect(another[0].templateParams).toEqual({ body: [mr.mrNumber, 'Check Xamar Steel too, please'], buttonUrlSuffix: request.id });

    await s.addQuote(request.id, { storeName: 'Xamar' });
    await svc.collect.send(env.as('collector'), request.id);
    const ready = await alerts(request.id, 'QUOTE_READY');
    expect(ready).toHaveLength(4); // 2 selectors × 2 rounds
    expect(new Set(ready.map((m) => m.idempotencyKey.split(':')[3])).size).toBe(2);
  });

  it('award → QUOTE_CHOSEN to the collector with store and who pays (Somali), no total', async () => {
    const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 1, estimate: 90 }] });
    const request = await s.collected(mr.id, ['Hodan']);
    await svc.collect.send(env.as('collector'), request.id);
    await svc.selection.enterTotal(env.as('selector'), request.id, request.quotes[0].id, '90');
    await svc.awards.award(env.as('selector'), request.id, {
      quoteId: request.quotes[0].id,
      paymentPath: 'FINANCE_PAYS_SUPPLIER',
      awardSupplierId: env.supplierId,
    });
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: env.supplierId } });
    const chosen = await alerts(request.id, 'QUOTE_CHOSEN');
    expect(chosen.map((m) => m.recipientUserId)).toEqual([env.userIds.collector]);
    expect(chosen[0].templateParams).toEqual({
      body: [supplier.name, mr.mrNumber, 'Maaliyadda ayaa bixinaysa'],
      buttonUrlSuffix: request.id,
    });
    expect(JSON.stringify(chosen[0].templateParams)).not.toContain('90');
  });

  describe('SLA chaser', () => {
    // Sent Saturday 08:00 Mogadishu (05:00Z).
    const SENT = new Date('2026-10-10T05:00:00Z');
    const at = (iso: string) => new Date(iso);

    async function waitingRequest(urgent = false) {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.collected(mr.id);
      await svc.collect.send(env.as('collector'), request.id);
      await prisma.quotationRequest.update({ where: { id: request.id }, data: { sentAt: SENT, urgent } });
      return request;
    }

    it('reminder once at 2 working hours, escalation once at 4 (CEO; the CFO has alerts off)', async () => {
      const request = await waitingRequest();
      await svc.slaJob.runTenant(at('2026-10-10T06:55:00Z')); // 115 min
      expect(await alerts(request.id, 'QUOTE_REMINDER')).toHaveLength(0);

      await svc.slaJob.runTenant(at('2026-10-10T07:05:00Z')); // 125 min
      expect(await recipientsOf(request.id, 'QUOTE_REMINDER')).toEqual(ids('selector', 'selector2'));
      const reminder = (await alerts(request.id, 'QUOTE_REMINDER'))[0];
      expect(reminder).toMatchObject({ templateName: 'quote_reminder_so', createdBy: env.userIds.collector });
      expect((reminder.templateParams as { body: string[] }).body[2]).toBe('2 saacadood');

      await svc.slaJob.runTenant(at('2026-10-10T07:10:00Z'));
      expect(await alerts(request.id, 'QUOTE_REMINDER')).toHaveLength(2);
      expect(await alerts(request.id, 'QUOTE_ESCALATION')).toHaveLength(0);

      await svc.slaJob.runTenant(at('2026-10-10T09:05:00Z')); // 245 min
      await svc.slaJob.runTenant(at('2026-10-10T09:10:00Z'));
      expect(await recipientsOf(request.id, 'QUOTE_ESCALATION')).toEqual(ids('selector2'));
      const escalation = (await alerts(request.id, 'QUOTE_ESCALATION'))[0];
      expect(escalation.templateParams).toEqual({
        body: [request.number, expect.any(String), 'Test Site', '4 saacadood'],
        buttonUrlSuffix: request.id,
      });
      expect(await alerts(request.id, 'QUOTE_REMINDER')).toHaveLength(2);
    });

    it('not outside working hours for a normal request; urgent counts clock hours; never after a decision', async () => {
      const normal = await waitingRequest();
      await svc.slaJob.runTenant(at('2026-10-10T20:00:00Z')); // Sat 23:00: 540 working minutes, but closed
      expect(await alerts(normal.id, 'QUOTE_REMINDER')).toHaveLength(0);

      const urgent = await waitingRequest(true);
      await svc.slaJob.runTenant(at('2026-10-10T20:00:00Z'));
      expect(await recipientsOf(urgent.id, 'QUOTE_ESCALATION')).toEqual(ids('selector2'));

      const decided = await waitingRequest(true);
      await svc.selection.askAnother(env.as('selector'), decided.id, 'one more');
      await svc.slaJob.runTenant(at('2026-10-10T20:00:00Z'));
      expect(await alerts(decided.id, 'QUOTE_REMINDER')).toHaveLength(0);
    });
  });

  it('the dispatcher sends queued alerts; the detail shows a masked delivery log; a stale alert is withdrawn', async () => {
    const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 1, estimate: 90 }] });
    const request = await s.collected(mr.id, ['Hodan']);
    await svc.collect.send(env.as('collector'), request.id);
    const onlyThisRequestDue = () =>
      prisma.outboundMessage.updateMany({
        where: { status: 'QUEUED', nextAttemptAt: { not: null }, NOT: { resourceId: request.id } },
        data: { nextAttemptAt: new Date('2999-01-01') },
      });
    await onlyThisRequestDue();
    expect(await svc.communication.dispatchDue(new Date())).toMatchObject({ sent: 2 }); // READY × 2

    // A reminder queued for this round, then finance decides before the dispatcher runs.
    const sent = await prisma.quotationRequest.findUniqueOrThrow({ where: { id: request.id } });
    await prisma.$transaction((tx) =>
      svc.alerts.queue(tx, {
        organizationId: env.orgId,
        requestId: request.id,
        purpose: 'QUOTE_REMINDER',
        round: decisionRound(sent),
        recipientUserIds: ids('selector'),
        facts: { number: request.number, mrNumber: mr.mrNumber, waitingMinutes: 130 },
        actorUserId: env.userIds.collector,
      }),
    );
    await svc.selection.enterTotal(env.as('selector'), request.id, request.quotes[0].id, '90');
    await svc.awards.award(env.as('selector'), request.id, {
      quoteId: request.quotes[0].id,
      paymentPath: 'BUYER_CASH',
      awardSupplierId: env.supplierId,
    });

    await onlyThisRequestDue();
    const summary = await svc.communication.dispatchDue(new Date());
    expect(summary).toMatchObject({ sent: 1, cancelled: 1 }); // CHOSEN goes; the reminder is stale

    const reminder = (await alerts(request.id, 'QUOTE_REMINDER'))[0];
    expect(reminder).toMatchObject({ status: 'FAILED', errorCode: 'NOT_NEEDED' });

    const detail = await svc.query.detail(env.as('collector'), request.id);
    expect(detail.messages).toHaveLength(4);
    const first = detail.messages.find((m) => m.purpose === 'QUOTE_READY' && m.recipientName === 'selector Tester')!;
    expect(first).toMatchObject({ status: 'SENT', recipientPhoneMasked: '…001', failureReason: null });
    expect(first.sentAt).not.toBeNull();
    expect(detail.messages.find((m) => m.purpose === 'QUOTE_REMINDER')).toMatchObject({
      status: 'FAILED',
      failureReason: 'Not sent: finance already decided.',
    });
    // No full number anywhere in the read model.
    expect(JSON.stringify(detail.messages)).not.toContain('612000001');
  });

  describe('review M2 / L4 — the pre-send check re-reads the round and the recipient', () => {
    const onlyDue = (requestId: string) =>
      prisma.outboundMessage.updateMany({
        where: { status: 'QUEUED', nextAttemptAt: { not: null }, NOT: { resourceId: requestId } },
        data: { nextAttemptAt: new Date('2999-01-01') },
      });
    const setMembership = (persona: Persona, status: 'ACTIVE' | 'SUSPENDED') =>
      prisma.organizationMembership.updateMany({ where: { organizationId: env.orgId, userId: env.userIds[persona] }, data: { status } });

    it('a "store chosen" from an award that was re-decided and awarded again is withdrawn; the new one goes', async () => {
      const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 1, estimate: 90 }] });
      const request = await s.collected(mr.id, ['Hodan']);
      await svc.collect.send(env.as('collector'), request.id);
      await svc.selection.enterTotal(env.as('selector'), request.id, request.quotes[0].id, '90');
      const award = { quoteId: request.quotes[0].id, paymentPath: 'BUYER_CASH' as const, awardSupplierId: env.supplierId };
      await svc.awards.award(env.as('selector'), request.id, award);
      await svc.orders.requestRedecision(env.as('collector'), request.id, 'Re-check');
      await svc.awards.award(env.as('selector'), request.id, { ...award, paymentPath: 'FINANCE_PAYS_SUPPLIER' });

      await onlyDue(request.id);
      await svc.communication.dispatchDue(new Date());
      const chosen = await alerts(request.id, 'QUOTE_CHOSEN');
      expect(chosen.map((m) => m.status)).toEqual(['FAILED', 'SENT']);
      expect(chosen[0]).toMatchObject({ errorCode: 'NOT_NEEDED', errorMessage: 'Not sent: a store was chosen again since.' });
    });

    it('re-reads the recipient: alerts turned off → withdrawn; number changed → sent to the new number', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.collected(mr.id);
      await svc.collect.send(env.as('collector'), request.id);
      await prisma.user.update({ where: { id: env.userIds.selector }, data: { whatsappAlertsEnabled: false } });
      await prisma.user.update({ where: { id: env.userIds.selector2 }, data: { whatsappPhone: '+252612000099' } });
      try {
        await onlyDue(request.id);
        await svc.communication.dispatchDue(new Date());
      } finally {
        await prisma.user.update({ where: { id: env.userIds.selector }, data: { whatsappAlertsEnabled: true } });
        await prisma.user.update({ where: { id: env.userIds.selector2 }, data: { whatsappPhone: PHONES.selector2!.phone } });
      }
      const ready = await alerts(request.id, 'QUOTE_READY');
      const bySelector = ready.find((m) => m.recipientUserId === env.userIds.selector)!;
      const bySelector2 = ready.find((m) => m.recipientUserId === env.userIds.selector2)!;
      expect(bySelector).toMatchObject({ status: 'FAILED', errorCode: 'NOT_NEEDED' });
      expect(bySelector2).toMatchObject({ status: 'SENT', recipient: '+252612000099' });
    });

    it('a recipient whose membership was suspended is neither queued nor sent to', async () => {
      const mr = await createApprovedMr(prisma, env);
      const request = await s.collected(mr.id);
      await svc.collect.send(env.as('collector'), request.id);
      await setMembership('selector2', 'SUSPENDED');
      await setMembership('collector', 'SUSPENDED');
      try {
        await onlyDue(request.id);
        await svc.communication.dispatchDue(new Date());
        // Ask-another while the collector is suspended: not queued for them (L4).
        await svc.selection.askAnother(env.as('selector'), request.id, 'one more');
      } finally {
        await setMembership('selector2', 'ACTIVE');
        await setMembership('collector', 'ACTIVE');
      }
      const ready = await alerts(request.id, 'QUOTE_READY');
      expect(ready.find((m) => m.recipientUserId === env.userIds.selector2)).toMatchObject({ status: 'FAILED', errorCode: 'NOT_NEEDED' });
      expect(ready.find((m) => m.recipientUserId === env.userIds.selector)).toMatchObject({ status: 'SENT' });
      expect(await alerts(request.id, 'QUOTE_ANOTHER')).toHaveLength(0);
    });
  });
});
