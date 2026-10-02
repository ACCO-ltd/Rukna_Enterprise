/**
 * WA — ADR-042 phase 2 communication core, against Postgres (tenant DB + platform DB).
 *
 *   WA-01  send: row QUEUED→SENT with provider id; platform route written for this tenant; audit row
 *          without the full phone number
 *   WA-02  (organization_id, idempotency_key) is unique in the DB; a repeat send returns the same row
 *          and sends once; two concurrent sends with one key → one row, one send
 *   WA-03  provider failure → FAILED row; retry reuses the row; provider_message_id is unique
 *   WA-04  status updates are monotonic against the DB (forward, repeats/regressions ignored,
 *          FAILED cannot override READ)
 *   WA-05  webhook dispatch end to end: route → tenant resolve → status applied; unknown id ignored
 *   WA-06  listForResource is org-scoped, newest first
 */
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { RequestIdentity } from '@erp/types';

import { PrismaService } from '../../database/prisma.service';
import { TenancyService } from '../../tenancy/tenancy.service';
import { tenancyStorage } from '../../tenancy/tenancy.context';
import { TransactionalAuditOutboxService } from '../../audit-logs/application/transactional-audit-outbox.service';
import { CommunicationService, type SendWhatsAppTemplateInput } from '../communication.service';
import { OutboundMessageRepository } from '../infrastructure/outbound-message.repository';
import { OutboundMessageRouteRepository } from '../infrastructure/outbound-message-route.repository';
import { WhatsAppWebhookService } from '../whatsapp/whatsapp-webhook.service';
import { WhatsAppSendError } from '../whatsapp/whatsapp.client';

const prisma = new PrismaClient();
const platform = new PrismaService();
const tenancy = new TenancyService(platform);
const routes = new OutboundMessageRouteRepository(platform);

let wamidSeq = 0;
const whatsapp = {
  uploadMedia: jest.fn(),
  sendTemplate: jest.fn(),
};
const service = new CommunicationService(
  { getClient: () => tenancyStorage.getStore()!.client } as never,
  new OutboundMessageRepository(),
  routes,
  whatsapp as never,
  new TransactionalAuditOutboxService(),
);
const webhook = new WhatsAppWebhookService({ get: () => undefined } as never, routes, tenancy, service);

const orgs: string[] = [];
let tenantId = '';
let tenantSlug = '';
const run = <T>(fn: () => Promise<T>) => tenancyStorage.run({ tenantId, tenantSlug, client: prisma }, fn);

async function makeOrg(): Promise<RequestIdentity> {
  const suffix = `wa${randomUUID().slice(0, 12)}`;
  const orgId = `test-org-${suffix}`;
  await prisma.organization.create({ data: { id: orgId, name: `WA ${suffix}`, slug: `test-${suffix}`, status: 'ACTIVE' } });
  const user = await prisma.user.create({
    data: { email: `wa-${suffix}@wa.test`, passwordHash: 'x', firstName: 'Hodan', lastName: 'Abdi', organizationId: orgId },
  });
  orgs.push(orgId);
  return { userId: user.id, activeOrganizationId: orgId, tenantSlug: `test-${suffix}`, roles: ['test'], permissions: [] };
}

const input = (over: Partial<SendWhatsAppTemplateInput> = {}): SendWhatsAppTemplateInput => ({
  purpose: 'INVOICE',
  recipient: '+252612345678',
  resourceType: 'client_invoice',
  resourceId: 'inv-1',
  templateName: 'rukna_invoice',
  language: 'en',
  bodyParams: ['Hodan'],
  idempotencyKey: `k-${randomUUID()}`,
  ...over,
});

beforeAll(async () => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  tenantSlug = `wa-test-${randomUUID().slice(0, 8)}`;
  const tenant = await platform.tenant.create({
    data: { slug: tenantSlug, name: 'WA test', dbUrl: process.env.DATABASE_URL!, status: 'ACTIVE' },
  });
  tenantId = tenant.id;
});

beforeEach(() => {
  whatsapp.uploadMedia.mockReset().mockResolvedValue('MEDIA');
  whatsapp.sendTemplate.mockReset().mockImplementation(async () => ({ providerMessageId: `wamid.test.${randomUUID()}.${++wamidSeq}` }));
});

afterAll(async () => {
  for (const orgId of orgs) {
    await prisma.$executeRaw`DELETE FROM audit_outbox_events WHERE organization_id = ${orgId}`;
    await prisma.auditLog.deleteMany({ where: { orgId } });
    await prisma.outboundMessage.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${orgId}`;
  }
  await platform.tenant.delete({ where: { id: tenantId } }); // cascades its routes
  await tenancy.onApplicationShutdown();
  await platform.$disconnect();
  await prisma.$disconnect();
});

describe('WA-01 send', () => {
  it('records SENT + provider id, writes the platform route and a masked audit row', async () => {
    const me = await makeOrg();
    const view = await run(() => service.sendWhatsAppTemplate(me, input({ document: { bytes: Buffer.from('%PDF'), mimeType: 'application/pdf', filename: 'a.pdf' } })));

    const row = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: view.id } });
    expect(row).toMatchObject({ status: 'SENT', channel: 'WHATSAPP', purpose: 'INVOICE', templateName: 'rukna_invoice', createdBy: me.userId });
    expect(row.providerMessageId).toMatch(/^wamid\.test\./);
    expect(row.sentAt).not.toBeNull();

    const route = await platform.outboundMessageRoute.findUnique({ where: { providerMessageId: row.providerMessageId! } });
    expect(route?.tenantId).toBe(tenantId);
    expect(await routes.findTenantSlug(row.providerMessageId!)).toBe(tenantSlug);

    const audit = await prisma.auditLog.findMany({ where: { orgId: me.activeOrganizationId, resource: 'outbound-message', resourceId: row.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('whatsapp.sent');
    expect(JSON.stringify(audit[0].after)).not.toContain('252612345678');
  });
});

describe('WA-02 idempotency', () => {
  it('the DB refuses a second row with the same (org, key)', async () => {
    const me = await makeOrg();
    const base = {
      organizationId: me.activeOrganizationId,
      channel: 'WHATSAPP' as const,
      purpose: 'RECEIPT' as const,
      recipient: '+252612345678',
      resourceType: 'payment_receipt',
      resourceId: 'r1',
      idempotencyKey: 'same',
      createdBy: me.userId,
    };
    await prisma.outboundMessage.create({ data: base });
    await expect(prisma.outboundMessage.create({ data: base })).rejects.toMatchObject({ code: 'P2002' });
    // Same key in another org is fine.
    const other = await makeOrg();
    await expect(prisma.outboundMessage.create({ data: { ...base, organizationId: other.activeOrganizationId } })).resolves.toBeDefined();
  });

  it('a repeat returns the same row and sends once', async () => {
    const me = await makeOrg();
    const req = input();
    const a = await run(() => service.sendWhatsAppTemplate(me, req));
    const b = await run(() => service.sendWhatsAppTemplate(me, req));
    expect(b).toEqual(a);
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('two concurrent sends with one key → one row, one send', async () => {
    const me = await makeOrg();
    const req = input();
    const [a, b] = await Promise.all([
      run(() => service.sendWhatsAppTemplate(me, req)),
      run(() => service.sendWhatsAppTemplate(me, req)),
    ]);
    expect(a.id).toBe(b.id);
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    expect(await prisma.outboundMessage.count({ where: { organizationId: me.activeOrganizationId } })).toBe(1);
  });
});

describe('WA-03 failure and retry', () => {
  it('provider failure → FAILED; a retry reuses the row and sends', async () => {
    const me = await makeOrg();
    whatsapp.sendTemplate.mockRejectedValueOnce(new WhatsAppSendError('TEMPLATE_NOT_APPROVED', 'Template rejected.', 132001));
    const req = input();
    const failed = await run(() => service.sendWhatsAppTemplate(me, req));
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'TEMPLATE_NOT_APPROVED', errorMessage: 'Template rejected.' });

    const retried = await run(() => service.sendWhatsAppTemplate(me, req));
    expect(retried).toMatchObject({ id: failed.id, status: 'SENT', errorCode: null, failedAt: null });
    const audit = await prisma.auditLog.findMany({ where: { resourceId: failed.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['whatsapp.failed', 'whatsapp.sent']);
  });

  it('provider_message_id is unique', async () => {
    const me = await makeOrg();
    const row = (key: string) => ({
      organizationId: me.activeOrganizationId,
      channel: 'WHATSAPP' as const,
      purpose: 'INVOICE' as const,
      recipient: '+252612345678',
      resourceType: 'client_invoice',
      resourceId: 'x',
      idempotencyKey: key,
      createdBy: me.userId,
      providerMessageId: `wamid.dup.${me.activeOrganizationId}`,
    });
    await prisma.outboundMessage.create({ data: row('a') });
    await expect(prisma.outboundMessage.create({ data: row('b') })).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('WA-04 status transitions', () => {
  it('forward only; FAILED overrides DELIVERED but not READ', async () => {
    const me = await makeOrg();
    const a = await run(() => service.sendWhatsAppTemplate(me, input()));
    const pid = (await prisma.outboundMessage.findUniqueOrThrow({ where: { id: a.id } })).providerMessageId!;
    const apply = (status: string, timestamp = '1727780000', errors?: Array<{ code: number }>) =>
      run(() => service.applyStatusUpdate({ providerMessageId: pid, status, timestamp, errors }));

    expect(await apply('delivered')).toBe('applied');
    expect(await apply('sent')).toBe('ignored');
    expect(await apply('delivered')).toBe('ignored');
    expect(await apply('read', '1727780100')).toBe('applied');
    expect(await apply('failed', '1727780200', [{ code: 131026 }])).toBe('ignored');
    const read = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: a.id } });
    expect(read).toMatchObject({ status: 'READ', errorCode: null });
    expect(read.deliveredAt).toEqual(new Date(1727780000 * 1000));
    expect(read.readAt).toEqual(new Date(1727780100 * 1000));

    const b = await run(() => service.sendWhatsAppTemplate(me, input()));
    const pidB = (await prisma.outboundMessage.findUniqueOrThrow({ where: { id: b.id } })).providerMessageId!;
    await run(() => service.applyStatusUpdate({ providerMessageId: pidB, status: 'delivered' }));
    expect(await run(() => service.applyStatusUpdate({ providerMessageId: pidB, status: 'failed', errors: [{ code: 131026 }] }))).toBe('applied');
    expect(await prisma.outboundMessage.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: 'FAILED', errorCode: '131026' });
  });
});

describe('WA-05 webhook dispatch', () => {
  it('routes a status to the right tenant DB; an unknown id is ignored', async () => {
    const me = await makeOrg();
    const a = await run(() => service.sendWhatsAppTemplate(me, input()));
    const pid = (await prisma.outboundMessage.findUniqueOrThrow({ where: { id: a.id } })).providerMessageId!;

    await webhook.dispatch([
      { messageId: 'wamid.never-sent-by-rukna', status: 'read', recipient: '…0000', timestamp: '1' },
      { messageId: pid, status: 'read', recipient: '…5678', timestamp: '1727780300' },
    ]);

    expect(await prisma.outboundMessage.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      status: 'READ',
      readAt: new Date(1727780300 * 1000),
    });
  });
});

describe('WA-06 list', () => {
  it('returns one org’s messages for a resource, newest first', async () => {
    const me = await makeOrg();
    const other = await makeOrg();
    const first = await run(() => service.sendWhatsAppTemplate(me, input({ resourceId: 'inv-L' })));
    const second = await run(() => service.sendWhatsAppTemplate(me, input({ resourceId: 'inv-L', purpose: 'PAYMENT_REMINDER' })));
    await run(() => service.sendWhatsAppTemplate(other, input({ resourceId: 'inv-L' })));
    await run(() => service.sendWhatsAppTemplate(me, input({ resourceId: 'inv-other' })));

    const list = await run(() => service.listForResource(me, 'client_invoice', 'inv-L'));
    expect(list.map((m) => m.id)).toEqual([second.id, first.id]);
    expect(list[0].recipient).toBe('+252612345678');
  });
});
