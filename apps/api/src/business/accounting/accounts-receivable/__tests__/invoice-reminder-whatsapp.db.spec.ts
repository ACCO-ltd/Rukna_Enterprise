/**
 * WAR — ADR-042 WhatsApp V1 step 4 (manual payment / overdue reminder), against Postgres (tenant DB
 * + platform DB). The WhatsApp client is mocked — Meta is never called.
 *
 *   WAR-01  overdue invoice → OVERDUE_REMINDER text-only message (no upload) + one InvoiceFollowUp
 *           (WHATSAPP) linked to it; the invoice's amounts / status and deliveries are untouched
 *   WAR-02  a repeat with the same idempotency key sends once and still records one follow-up
 *   WAR-03  a paid invoice (nothing outstanding) is refused 409 NOTHING_OUTSTANDING; nothing sent
 *   WAR-04  a later FAILED webhook voids the follow-up; a hand-recorded follow-up is untouched
 *   WAR-05  the reminders list under resourceType 'client_invoice_reminder' for the invoice
 */
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { RequestIdentity } from '@erp/types';

import { PrismaService } from '../../../../platform/database/prisma.service';
import { tenancyStorage } from '../../../../platform/tenancy/tenancy.context';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service';
import { CommunicationService } from '../../../../platform/messaging/communication.service';
import { OutboundMessageRepository } from '../../../../platform/messaging/infrastructure/outbound-message.repository';
import { OutboundMessageRouteRepository } from '../../../../platform/messaging/infrastructure/outbound-message-route.repository';
import { InvoiceWhatsAppRepository } from '../infrastructure/invoice-whatsapp.repository';
import { InvoiceReminderWhatsAppService } from '../application/invoice-reminder-whatsapp.service';

const prisma = new PrismaClient();
const platform = new PrismaService();
const tenancy = { getClient: () => tenancyStorage.getStore()!.client } as never;

const whatsapp = { isConfigured: () => true, uploadMedia: jest.fn(), sendTemplate: jest.fn() };
const communication = new CommunicationService(
  tenancy,
  new OutboundMessageRepository(),
  new OutboundMessageRouteRepository(platform),
  whatsapp as never,
  new TransactionalAuditOutboxService(),
);
const env: Record<string, string> = {
  WHATSAPP_TEMPLATE_PAYMENT_REMINDER: 'rukna_payment_reminder',
  WHATSAPP_TEMPLATE_OVERDUE_REMINDER: 'rukna_overdue_reminder',
};
const service = new InvoiceReminderWhatsAppService(
  tenancy,
  { get: (key: string) => env[key] } as never,
  whatsapp as never,
  communication,
  new InvoiceWhatsAppRepository(),
  new TransactionalAuditOutboxService(),
);
service.onModuleInit();

const orgs: string[] = [];
let tenantId = '';
let tenantSlug = '';
const run = <T>(fn: () => Promise<T>) =>
  tenancyStorage.run({ tenantId, tenantSlug, client: prisma }, fn);

async function makeInvoice(over: { outstandingAmount?: string; dueDate?: Date } = {}) {
  const suffix = `war${randomUUID().slice(0, 12)}`;
  const orgId = `test-org-${suffix}`;
  await prisma.organization.create({
    data: { id: orgId, name: 'ACCO Ltd', slug: `test-${suffix}`, status: 'ACTIVE' },
  });
  const user = await prisma.user.create({
    data: {
      email: `war-${suffix}@wa.test`,
      passwordHash: 'x',
      firstName: 'Hodan',
      lastName: 'Abdi',
      organizationId: orgId,
    },
  });
  orgs.push(orgId);
  const client = await prisma.client.create({
    data: {
      organizationId: orgId,
      code: 'CL-1',
      name: 'Hodan Construction Ltd',
      contacts: {
        create: [{ name: 'Hodan', whatsappPhone: '+252615555555', isPrimary: true }],
      },
    },
  });
  const invoice = await prisma.clientInvoice.create({
    data: {
      organizationId: orgId,
      clientId: client.id,
      invoiceNumber: 'INV-000042',
      invoiceDate: new Date('2026-08-01T00:00:00Z'),
      dueDate: over.dueDate ?? new Date('2026-09-01T00:00:00Z'),
      currencyCode: 'USD',
      subtotal: '12500.00',
      vatAmount: '0.00',
      totalAmount: '12500.00',
      outstandingAmount: over.outstandingAmount ?? '4500.00',
      billingAddressSnapshot: {
        client: { name: 'Hodan Construction Ltd' },
        org: { name: 'ACCO Ltd' },
      },
      documentStatus: 'APPROVED',
      postingStatus: 'POSTED',
      createdBy: user.id,
    },
  });
  const me: RequestIdentity = {
    userId: user.id,
    activeOrganizationId: orgId,
    tenantSlug: `test-${suffix}`,
    roles: ['test'],
    permissions: [],
  };
  return { me, invoiceId: invoice.id };
}

const followUps = (invoiceId: string) => prisma.invoiceFollowUp.findMany({ where: { invoiceId } });

beforeAll(async () => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  tenantSlug = `war-test-${randomUUID().slice(0, 8)}`;
  const tenant = await platform.tenant.create({
    data: {
      slug: tenantSlug,
      name: 'WAR test',
      dbUrl: process.env.DATABASE_URL!,
      status: 'ACTIVE',
    },
  });
  tenantId = tenant.id;
});

beforeEach(() => {
  whatsapp.uploadMedia.mockReset();
  whatsapp.sendTemplate
    .mockReset()
    .mockImplementation(async () => ({ providerMessageId: `wamid.war.${randomUUID()}` }));
});

afterAll(async () => {
  for (const orgId of orgs) {
    await prisma.$executeRaw`DELETE FROM audit_outbox_events WHERE organization_id = ${orgId}`;
    await prisma.auditLog.deleteMany({ where: { orgId } });
    await prisma.invoiceFollowUp.deleteMany({ where: { organizationId: orgId } });
    await prisma.outboundMessage.deleteMany({ where: { organizationId: orgId } });
    await prisma.clientInvoice.deleteMany({ where: { organizationId: orgId } });
    await prisma.client.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${orgId}`;
  }
  await platform.tenant.delete({ where: { id: tenantId } });
  await platform.$disconnect();
  await prisma.$disconnect();
});

describe('WAR-01/02 send', () => {
  it('sends the overdue reminder as text and records one follow-up, once per key', async () => {
    const { me, invoiceId } = await makeInvoice();
    const preview = await run(() => service.preview(me, invoiceId));
    expect(preview).toMatchObject({ kind: 'OVERDUE_REMINDER', sendable: true, filename: null });

    const key = randomUUID();
    const view = await run(() => service.send(me, invoiceId, { idempotencyKey: key }));
    const again = await run(() => service.send(me, invoiceId, { idempotencyKey: key }));
    expect(view.status).toBe('SENT');
    expect(again.id).toBe(view.id);
    expect(view).toMatchObject({
      purpose: 'OVERDUE_REMINDER',
      resourceType: 'client_invoice_reminder',
      resourceId: invoiceId,
    });
    expect(whatsapp.uploadMedia).not.toHaveBeenCalled();
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendTemplate.mock.calls[0][0]).toMatchObject({
      to: '+252615555555',
      templateName: 'rukna_overdue_reminder',
      bodyParams: [
        'Hodan Construction Ltd',
        'INV-000042',
        'USD 4,500.00',
        '01 Sep 2026',
        'ACCO Ltd',
      ],
    });

    const rows = await followUps(invoiceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'WHATSAPP', outboundMessageId: view.id });

    const inv = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv.outstandingAmount.toFixed(2)).toBe('4500.00');
    expect(inv.documentStatus).toBe('APPROVED');
    expect(await prisma.clientInvoiceDelivery.count({ where: { invoiceId } })).toBe(0);

    // WAR-05 — the reminders list for the invoice under their own resourceType.
    const listed = await run(() =>
      communication.listForResource(me, 'client_invoice_reminder', invoiceId),
    );
    expect(listed.map((m) => m.id)).toEqual([view.id]);
  });

  it('a not-yet-due invoice gets the payment reminder', async () => {
    const { me, invoiceId } = await makeInvoice({ dueDate: new Date('2099-01-01T00:00:00Z') });
    const view = await run(() => service.send(me, invoiceId, { idempotencyKey: randomUUID() }));
    expect(view.purpose).toBe('PAYMENT_REMINDER');
  });
});

describe('WAR-03 refusals', () => {
  it('refuses a paid invoice and sends nothing', async () => {
    const { me, invoiceId } = await makeInvoice({ outstandingAmount: '0.00' });
    await expect(
      run(() => service.send(me, invoiceId, { idempotencyKey: randomUUID() })),
    ).rejects.toMatchObject({ status: 409, response: { errorCode: 'NOTHING_OUTSTANDING' } });
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(await prisma.outboundMessage.count({ where: { resourceId: invoiceId } })).toBe(0);
  });
});

describe('WAR-04 failed webhook', () => {
  it('voids the reminder follow-up only', async () => {
    const { me, invoiceId } = await makeInvoice();
    await prisma.invoiceFollowUp.create({
      data: {
        organizationId: me.activeOrganizationId,
        invoiceId,
        method: 'WHATSAPP',
        note: 'called on WhatsApp by hand',
        occurredAt: new Date(),
        recordedBy: me.userId,
      },
    });
    const view = await run(() => service.send(me, invoiceId, { idempotencyKey: randomUUID() }));
    expect(await followUps(invoiceId)).toHaveLength(2);

    const row = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: view.id } });
    const outcome = await run(() =>
      communication.applyStatusUpdate({
        providerMessageId: row.providerMessageId!,
        status: 'failed',
        errors: [{ code: 131026, title: 'Message undeliverable' }],
      }),
    );
    expect(outcome).toBe('applied');
    const left = await followUps(invoiceId);
    expect(left).toHaveLength(1);
    expect(left[0].outboundMessageId).toBeNull();
  });
});
