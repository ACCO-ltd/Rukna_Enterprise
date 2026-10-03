/**
 * WAI — ADR-042 WhatsApp V1 step 2 (send invoice), against Postgres (tenant DB + platform DB).
 * The WhatsApp client is mocked — Meta is never called.
 *
 *   WAI-01  send → one OutboundMessage (SENT) + one ClientInvoiceDelivery (WHATSAPP) linked to it
 *   WAI-02  a repeat with the same idempotency key sends once and still records one delivery
 *   WAI-03  a provider refusal → FAILED message, no delivery
 *   WAI-04  outcome unknown → UNKNOWN, no delivery; resolve as SENT records exactly one delivery;
 *           resolve again → 409; resolve as FAILED records none and a new key sends again
 *   WAI-05  refusals: not issued (409 NOT_POSTED), invalid number (400 RECIPIENT_INVALID)
 *   WAI-06  webhooks: a later FAILED voids the delivery (audited) and the invoice has none left; a
 *           hand-recorded delivery is untouched; a webhook confirming an UNKNOWN message records it
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
import { WhatsAppSendError } from '../../../../platform/messaging/whatsapp/whatsapp.client';
import { InvoiceWhatsAppRepository } from '../infrastructure/invoice-whatsapp.repository';
import { InvoiceWhatsAppService } from '../application/invoice-whatsapp.service';

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
const invoices = { readDocumentBytes: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 test')) };
const service = new InvoiceWhatsAppService(
  tenancy,
  {
    get: (key: string) => (key === 'WHATSAPP_TEMPLATE_INVOICE' ? 'rukna_invoice' : undefined),
  } as never,
  whatsapp as never,
  communication,
  invoices as never,
  new InvoiceWhatsAppRepository(),
  new TransactionalAuditOutboxService(),
);
service.onModuleInit();

const orgs: string[] = [];
let tenantId = '';
let tenantSlug = '';
const run = <T>(fn: () => Promise<T>) =>
  tenancyStorage.run({ tenantId, tenantSlug, client: prisma }, fn);

async function makeInvoice(
  over: { postingStatus?: 'POSTED' | 'NOT_POSTED'; invoiceNumber?: string | null } = {},
) {
  const suffix = `wai${randomUUID().slice(0, 12)}`;
  const orgId = `test-org-${suffix}`;
  await prisma.organization.create({
    data: { id: orgId, name: 'ACCO Ltd', slug: `test-${suffix}`, status: 'ACTIVE' },
  });
  const user = await prisma.user.create({
    data: {
      email: `wai-${suffix}@wa.test`,
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
        create: [
          { name: 'Ali', phone: '+252612345678' },
          {
            name: 'Hodan',
            phone: '+252612222222',
            whatsappPhone: '+252615555555',
            isPrimary: true,
          },
        ],
      },
    },
  });
  const invoice = await prisma.clientInvoice.create({
    data: {
      organizationId: orgId,
      clientId: client.id,
      invoiceNumber: over.invoiceNumber === undefined ? 'INV-000042' : over.invoiceNumber,
      invoiceDate: new Date('2026-10-01T00:00:00Z'),
      dueDate: new Date('2026-10-15T00:00:00Z'),
      currencyCode: 'USD',
      subtotal: '12500.00',
      vatAmount: '0.00',
      totalAmount: '12500.00',
      outstandingAmount: '12500.00',
      billingAddressSnapshot: {
        client: { name: 'Hodan Construction Ltd' },
        org: { name: 'ACCO Ltd' },
      },
      documentStatus: 'APPROVED',
      postingStatus: over.postingStatus ?? 'POSTED',
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

const deliveries = (invoiceId: string) =>
  prisma.clientInvoiceDelivery.findMany({ where: { invoiceId } });

beforeAll(async () => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  tenantSlug = `wai-test-${randomUUID().slice(0, 8)}`;
  const tenant = await platform.tenant.create({
    data: {
      slug: tenantSlug,
      name: 'WAI test',
      dbUrl: process.env.DATABASE_URL!,
      status: 'ACTIVE',
    },
  });
  tenantId = tenant.id;
});

beforeEach(() => {
  whatsapp.uploadMedia.mockReset().mockResolvedValue('MEDIA');
  whatsapp.sendTemplate
    .mockReset()
    .mockImplementation(async () => ({ providerMessageId: `wamid.wai.${randomUUID()}` }));
});

afterAll(async () => {
  for (const orgId of orgs) {
    await prisma.$executeRaw`DELETE FROM audit_outbox_events WHERE organization_id = ${orgId}`;
    await prisma.auditLog.deleteMany({ where: { orgId } });
    await prisma.clientInvoiceDelivery.deleteMany({ where: { organizationId: orgId } });
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

describe('WAI-01 send', () => {
  it('sends to the primary contact and records one WhatsApp delivery linked to the message', async () => {
    const { me, invoiceId } = await makeInvoice();
    const preview = await run(() => service.preview(me, invoiceId));
    expect(preview).toMatchObject({
      sendable: true,
      defaultRecipient: '+252615555555',
      filename: 'INV-000042.pdf',
    });

    const view = await run(() => service.send(me, invoiceId, { idempotencyKey: randomUUID() }));
    expect(view.status).toBe('SENT');
    expect(whatsapp.uploadMedia).toHaveBeenCalledWith(
      Buffer.from('%PDF-1.7 test'),
      'application/pdf',
      'INV-000042.pdf',
    );
    expect(whatsapp.sendTemplate.mock.calls[0][0]).toMatchObject({
      to: '+252615555555',
      templateName: 'rukna_invoice',
      bodyParams: [
        'Hodan Construction Ltd',
        'INV-000042',
        'USD 12,500.00',
        '15 Oct 2026',
        'ACCO Ltd',
      ],
    });

    const rows = await deliveries(invoiceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      method: 'WHATSAPP',
      recipient: '+252615555555',
      sentBy: me.userId,
      outboundMessageId: view.id,
    });
  });
});

describe('WAI-02 idempotency', () => {
  it('a repeat with the same key sends once and keeps one delivery', async () => {
    const { me, invoiceId } = await makeInvoice();
    const key = randomUUID();
    const first = await run(() => service.send(me, invoiceId, { idempotencyKey: key }));
    const again = await run(() => service.send(me, invoiceId, { idempotencyKey: key }));
    expect(again.id).toBe(first.id);
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    expect(await deliveries(invoiceId)).toHaveLength(1);
  });

  it('the database keeps one delivery per message', async () => {
    const { me, invoiceId } = await makeInvoice();
    const view = await run(() => service.send(me, invoiceId, { idempotencyKey: randomUUID() }));
    const repo = new InvoiceWhatsAppRepository();
    const data = {
      organizationId: me.activeOrganizationId,
      invoiceId,
      recipient: '+252615555555',
      sentAt: new Date(),
      sentBy: me.userId,
      outboundMessageId: view.id,
    };
    expect(await repo.recordMessageDelivery(prisma, data)).toBe(false);
    await expect(
      prisma.clientInvoiceDelivery.create({ data: { ...data, method: 'WHATSAPP' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('WAI-03 provider refusal', () => {
  it('returns the FAILED message and records no delivery', async () => {
    const { me, invoiceId } = await makeInvoice();
    whatsapp.sendTemplate.mockRejectedValue(
      new WhatsAppSendError('INVALID_RECIPIENT', 'not on WhatsApp', 131026),
    );
    const view = await run(() => service.send(me, invoiceId, { idempotencyKey: randomUUID() }));
    expect(view).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_RECIPIENT' });
    expect(await deliveries(invoiceId)).toHaveLength(0);
  });
});

describe('WAI-04 outcome unknown + manual resolve', () => {
  const timeout = () => new WhatsAppSendError('NETWORK', 'timeout', undefined, true);

  it('UNKNOWN records nothing; resolving as SENT records exactly one delivery; a second resolve is 409', async () => {
    const { me, invoiceId } = await makeInvoice();
    whatsapp.sendTemplate.mockRejectedValue(timeout());
    const view = await run(() => service.send(me, invoiceId, { idempotencyKey: randomUUID() }));
    expect(view.status).toBe('UNKNOWN');
    expect(await deliveries(invoiceId)).toHaveLength(0);

    const resolved = await run(() =>
      communication.resolveUnknown(me, view.id, { outcome: 'SENT', note: 'Client confirmed' }),
    );
    expect(resolved.status).toBe('SENT');
    expect(resolved.sentAt).not.toBeNull();
    const rows = await deliveries(invoiceId);
    expect(rows).toHaveLength(1);
    expect(rows[0].outboundMessageId).toBe(view.id);

    const audit = await prisma.auditLog.findMany({
      where: {
        orgId: me.activeOrganizationId,
        resourceId: view.id,
        action: 'whatsapp.resolved-sent',
      },
    });
    expect(audit).toHaveLength(1);

    await expect(
      run(() => communication.resolveUnknown(me, view.id, { outcome: 'SENT' })),
    ).rejects.toMatchObject({ status: 409 });
    expect(await deliveries(invoiceId)).toHaveLength(1);
  });

  it('resolving as FAILED records no delivery and a new key sends again', async () => {
    const { me, invoiceId } = await makeInvoice();
    whatsapp.sendTemplate.mockRejectedValueOnce(timeout());
    const view = await run(() => service.send(me, invoiceId, { idempotencyKey: randomUUID() }));
    const failed = await run(() =>
      communication.resolveUnknown(me, view.id, { outcome: 'FAILED' }),
    );
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'MARKED_FAILED' });
    expect(await deliveries(invoiceId)).toHaveLength(0);

    const retry = await run(() => service.send(me, invoiceId, { idempotencyKey: randomUUID() }));
    expect(retry.status).toBe('SENT');
    expect(retry.id).not.toBe(view.id);
    expect(await deliveries(invoiceId)).toHaveLength(1);
  });

  it('another organisation cannot resolve the message', async () => {
    const { me, invoiceId } = await makeInvoice();
    const other = await makeInvoice();
    whatsapp.sendTemplate.mockRejectedValue(timeout());
    const view = await run(() => service.send(me, invoiceId, { idempotencyKey: randomUUID() }));
    await expect(
      run(() => communication.resolveUnknown(other.me, view.id, { outcome: 'SENT' })),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('WAI-05 refusals', () => {
  it('an unissued invoice is refused with NOT_POSTED and nothing is recorded', async () => {
    const { me, invoiceId } = await makeInvoice({
      postingStatus: 'NOT_POSTED',
      invoiceNumber: null,
    });
    await expect(
      run(() => service.send(me, invoiceId, { idempotencyKey: randomUUID() })),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'NOT_POSTED' },
    });
    expect(await prisma.outboundMessage.count({ where: { resourceId: invoiceId } })).toBe(0);
  });

  it('an invalid number is refused with RECIPIENT_INVALID', async () => {
    const { me, invoiceId } = await makeInvoice();
    await expect(
      run(() => service.send(me, invoiceId, { recipient: '+1234', idempotencyKey: randomUUID() })),
    ).rejects.toMatchObject({ status: 400, response: { errorCode: 'RECIPIENT_INVALID' } });
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });
});

describe('WAI-06 webhook status follows through to the delivery', () => {
  const providerId = async (id: string) =>
    (await prisma.outboundMessage.findUniqueOrThrow({ where: { id } })).providerMessageId!;

  it('a FAILED webhook after SENT voids the WhatsApp delivery and audits it; manual deliveries stay', async () => {
    const { me, invoiceId } = await makeInvoice();
    await prisma.clientInvoiceDelivery.create({
      data: {
        organizationId: me.activeOrganizationId,
        invoiceId,
        method: 'EMAIL',
        sentAt: new Date(),
        sentBy: me.userId,
      },
    });
    const view = await run(() => service.send(me, invoiceId, { idempotencyKey: randomUUID() }));
    expect(await deliveries(invoiceId)).toHaveLength(2);

    const pid = await providerId(view.id);
    expect(
      await run(() =>
        communication.applyStatusUpdate({
          providerMessageId: pid,
          status: 'failed',
          errors: [{ code: 131026 }],
        }),
      ),
    ).toBe('applied');

    const left = await deliveries(invoiceId);
    expect(left).toHaveLength(1);
    expect(left[0].method).toBe('EMAIL');
    const audit = await prisma.auditLog.findMany({
      where: { orgId: me.activeOrganizationId, action: 'whatsapp delivery voided: message failed' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ resourceId: invoiceId, userId: me.userId });
  });

  it('a webhook confirming an UNKNOWN message records the delivery once', async () => {
    const { me, invoiceId } = await makeInvoice();
    whatsapp.sendTemplate.mockRejectedValue(
      new WhatsAppSendError('NETWORK', 'timeout', undefined, true),
    );
    const view = await run(() => service.send(me, invoiceId, { idempotencyKey: randomUUID() }));
    expect(view.status).toBe('UNKNOWN');
    // Meta's id is unknown to us for an unanswered send; attach one as if it had arrived.
    await prisma.outboundMessage.update({
      where: { id: view.id },
      data: { providerMessageId: `wamid.wai.${view.id}` },
    });
    await run(() =>
      communication.applyStatusUpdate({
        providerMessageId: `wamid.wai.${view.id}`,
        status: 'delivered',
      }),
    );
    await run(() =>
      communication.applyStatusUpdate({
        providerMessageId: `wamid.wai.${view.id}`,
        status: 'read',
      }),
    );
    const rows = await deliveries(invoiceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outboundMessageId: view.id, sentBy: me.userId });
  });
});
