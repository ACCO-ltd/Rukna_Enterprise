/**
 * RCP — receipt PDF + send receipt by WhatsApp (WhatsApp V1 step 3), against Postgres.
 *
 *   RCP-01  a draft (NOT_POSTED) receipt has no document and cannot be sent; nothing is stored
 *   RCP-02  a posted receipt's document is rendered ONCE, bound, IMMUTABLE, readable by
 *           manage:receivable through the file authorization; it does not change after a later
 *           allocation or a branding change
 *   RCP-03  two concurrent first requests bind one document; the loser's file is discarded
 *   RCP-04  send → one OutboundMessage (RECEIPT, payment_receipt, SENT) with the PDF attached and
 *           the template params; a repeat with the same key returns it without sending again
 *   RCP-05  preview: recipients from the client's contacts, the exact message, sendable
 *   RCP-06  a commercial-style receipt (createAndPost, bankAccountId set) gets the same document
 *
 * WhatsApp (Meta) is never called: the client is a jest mock. The PDF renderer is the Jest stub of
 * @react-pdf/renderer (bytes 'stub-pdf'); what the PDF says is covered by receipt-document.service.spec.
 */
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { AccountingFixtureFactory, type AccountingTestEnv } from './helpers/fixture.factory';
import { buildServices, type AccountingServices } from './helpers/build-services';
import { PaymentReceiptArRepository } from '../accounts-receivable/infrastructure/payment-receipt-ar.repository';
import { ReceiptDocumentService } from '../accounts-receivable/application/receipt-document.service';
import { PaymentReceiptDocumentService } from '../accounts-receivable/application/payment-receipt-document.service';
import { ReceiptWhatsAppService } from '../accounts-receivable/application/receipt-whatsapp.service';
import { PlatformFileService } from '../../../platform/files/application/platform-file.service';
import { PlatformFileRepository } from '../../../platform/files/infrastructure/platform-file.repository';
import { FileAuthorizationService } from '../../../platform/files/application/file-authorization.service';
import type { IFileStoragePort } from '../../../platform/files/application/ports/file-storage.port';
import { CommunicationService } from '../../../platform/messaging/communication.service';
import { OutboundMessageRepository } from '../../../platform/messaging/infrastructure/outbound-message.repository';
import { OutboundMessageRouteRepository } from '../../../platform/messaging/infrastructure/outbound-message-route.repository';
import { TransactionalAuditOutboxService } from '../../../platform/audit-logs/application/transactional-audit-outbox.service';
import { PrismaService } from '../../../platform/database/prisma.service';
import { tenancyStorage } from '../../../platform/tenancy/tenancy.context';

const prisma = new PrismaClient();
const platform = new PrismaService();
let env: AccountingTestEnv;
let svc: AccountingServices;
let me: RequestIdentity;
let tenantId = '';
let tenantSlug = '';

// In-memory object storage.
const objects = new Map<string, Buffer>();
const storage: IFileStoragePort = {
  presignUpload: async () => 'http://upload',
  presignDownload: async (_bucket, key) => `http://download/${key}`,
  statObject: async (_bucket, key) => ({ exists: objects.has(key), sizeBytes: objects.get(key)?.length ?? 0 }),
  deleteObject: async (_bucket, key) => void objects.delete(key),
  putObject: async (_bucket, key, body) => void objects.set(key, body),
  getObject: async (_bucket, key) => objects.get(key) ?? Buffer.alloc(0),
};

const whatsapp = { isConfigured: jest.fn(() => true), uploadMedia: jest.fn(), sendTemplate: jest.fn() };
const renderer = new ReceiptDocumentService();
let renderSpy: jest.SpyInstance;
let documents: PaymentReceiptDocumentService;
let sender: ReceiptWhatsAppService;

const run = <T>(fn: () => Promise<T>) => tenancyStorage.run({ tenantId, tenantSlug, client: prisma }, fn);

beforeAll(async () => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  const user = await prisma.user.create({
    data: {
      email: `rcp-${randomUUID().slice(0, 8)}@rcp.test`,
      passwordHash: 'x',
      firstName: 'Hodan',
      lastName: 'Abdi',
      organizationId: env.orgId,
    },
  });
  me = { ...env.identity, userId: user.id, roles: ['finance'], permissions: [PERMISSIONS.receivablesManage] };

  tenantSlug = `rcp-test-${randomUUID().slice(0, 8)}`;
  tenantId = (await platform.tenant.create({ data: { slug: tenantSlug, name: 'RCP test', dbUrl: process.env.DATABASE_URL!, status: 'ACTIVE' } })).id;

  await prisma.client.update({ where: { id: env.clientId }, data: { name: 'Hodan Construction Ltd', address: 'KM4, Mogadishu' } });
  await prisma.clientContact.create({
    data: { clientId: env.clientId, name: 'Amina', role: 'Finance', whatsappPhone: '+252615555555', isPrimary: true },
  });
  await prisma.organization.update({ where: { id: env.orgId }, data: { name: 'ACCO Ltd', invoiceFooterNote: 'Thank you.' } });

  const tenancy = { getClient: () => prisma } as never;
  const files = new PlatformFileService(
    tenancy,
    new PlatformFileRepository(),
    { get: () => undefined } as never,
    new FileAuthorizationService(tenancy, {} as never),
    storage,
  );
  renderSpy = jest.spyOn(renderer, 'render');
  const repo = new PaymentReceiptArRepository();
  documents = new PaymentReceiptDocumentService(tenancy, repo, renderer, files);
  const communication = new CommunicationService(
    tenancy,
    new OutboundMessageRepository(),
    new OutboundMessageRouteRepository(platform),
    whatsapp as never,
    new TransactionalAuditOutboxService(),
  );
  const config = { get: (key: string) => (key === 'WHATSAPP_TEMPLATE_RECEIPT' ? 'rukna_receipt' : undefined) };
  sender = new ReceiptWhatsAppService(tenancy, repo, documents, communication, whatsapp as never, config as never);
});

beforeEach(() => {
  renderSpy.mockClear();
  whatsapp.uploadMedia.mockReset().mockResolvedValue('MEDIA-1');
  whatsapp.sendTemplate.mockReset().mockImplementation(async () => ({ providerMessageId: `wamid.rcp.${randomUUID()}` }));
});

afterAll(async () => {
  const orgId = env.orgId;
  await prisma.$executeRaw`DELETE FROM audit_outbox_events WHERE organization_id = ${orgId}`;
  await prisma.auditLog.deleteMany({ where: { orgId } });
  await prisma.outboundMessage.deleteMany({ where: { organizationId: orgId } });
  await prisma.$executeRaw`UPDATE payment_receipts SET document_file_id = NULL WHERE organization_id = ${orgId}`;
  await prisma.platformFile.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await AccountingFixtureFactory.cleanup(prisma, orgId);
  await platform.tenant.delete({ where: { id: tenantId } });
  await platform.$disconnect();
  await prisma.$disconnect();
});

async function postedInvoice(amount: number) {
  const inv = await prisma.clientInvoice.create({
    data: {
      organizationId: env.orgId,
      clientId: env.clientId,
      invoiceDate: env.periods.openStart,
      dueDate: env.periods.openEnd,
      currencyCode: 'USD',
      subtotal: new Decimal(amount),
      vatAmount: new Decimal(0),
      totalAmount: new Decimal(amount),
      outstandingAmount: new Decimal(amount),
      billingAddressSnapshot: {},
      documentStatus: 'APPROVED',
      postingStatus: 'NOT_POSTED',
      createdBy: env.identity.userId,
    },
  });
  await svc.clientInvoiceService.post(env.identity, {
    invoiceId: inv.id,
    arAccountCode: env.accounts.arCode,
    revenueAccountCode: env.accounts.revCode,
  });
  return prisma.clientInvoice.findUniqueOrThrow({ where: { id: inv.id } });
}

async function draftReceipt(amount: number) {
  return prisma.paymentReceipt.create({
    data: {
      organizationId: env.orgId,
      clientId: env.clientId,
      receiptDate: env.periods.openStart,
      accountingDate: env.periods.openStart,
      totalAmount: new Decimal(amount),
      allocatedAmount: new Decimal(0),
      unallocatedAmount: new Decimal(amount),
      currencyCode: 'USD',
      paymentMethod: 'BANK_TRANSFER',
      reference: 'Stage 2',
      documentStatus: 'APPROVED',
      postingStatus: 'NOT_POSTED',
      createdBy: env.identity.userId,
    },
  });
}

/** A posted receipt of 5,000 applied 3,000 + 1,500 at posting, 500 held on account. */
async function postedReceipt() {
  const a = await postedInvoice(3000);
  const b = await postedInvoice(2000);
  const receipt = await draftReceipt(5000);
  await svc.customerReceiptService.post(env.identity, {
    receiptId: receipt.id,
    bankAccountCode: env.accounts.bankCode,
    arAccountCode: env.accounts.arCode,
    unappliedAccountCode: env.accounts.unaplCode,
    allocations: [
      { clientInvoiceId: a.id, amount: 3000 },
      { clientInvoiceId: b.id, amount: 1500 },
    ],
  });
  return { receipt: await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: receipt.id } }), a, b };
}

const errorCode = (e: unknown) => (e as { getResponse(): { errorCode?: string } }).getResponse().errorCode;

describe('RCP-01 draft receipt', () => {
  it('has no document and cannot be sent; nothing is stored or sent', async () => {
    const receipt = await draftReceipt(100);
    const filesBefore = await prisma.platformFile.count({ where: { organizationId: env.orgId } });

    expect(errorCode(await run(() => documents.getOrGenerateReceiptDocument(me, receipt.id)).catch((e) => e))).toBe('NOT_POSTED');
    expect(errorCode(await run(() => sender.send(me, receipt.id, { idempotencyKey: 'k' })).catch((e) => e))).toBe('NOT_POSTED');
    const preview = await run(() => sender.preview(me, receipt.id));
    expect(preview).toMatchObject({ sendable: false, blockedReason: 'NOT_POSTED', filename: 'receipt.pdf' });

    expect(renderSpy).not.toHaveBeenCalled();
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(await prisma.platformFile.count({ where: { organizationId: env.orgId } })).toBe(filesBefore);
    expect(await prisma.outboundMessage.count({ where: { resourceId: receipt.id } })).toBe(0);
  });
});

describe('RCP-02 document generated once and frozen', () => {
  it('renders once, binds an IMMUTABLE file, and later changes do not touch it', async () => {
    const { receipt, b } = await postedReceipt();
    expect(receipt.receiptNumber).toMatch(/^RCP-/);

    const first = await run(() => documents.getOrGenerateReceiptDocument(me, receipt.id));
    expect(first).toMatchObject({ mimeType: 'application/pdf', originalName: `${receipt.receiptNumber}.pdf` });
    expect(renderSpy).toHaveBeenCalledTimes(1);
    const input = renderSpy.mock.calls[0][0];
    expect(input).toMatchObject({
      receiptNumber: receipt.receiptNumber,
      totalAmount: '5000.00',
      unallocatedAmount: '500.00',
      clientName: 'Hodan Construction Ltd',
      clientAddress: 'KM4, Mogadishu',
      paymentMethod: 'BANK_TRANSFER',
      reference: 'Stage 2',
      org: expect.objectContaining({ name: 'ACCO Ltd', footerNote: 'Thank you.' }),
    });
    expect(input.allocations.map((a: { amount: string }) => a.amount)).toEqual(['3000.00', '1500.00']);
    expect(input.allocations[0].invoiceNumber).toBeTruthy();
    // AR posting picks the bank by GL code; the bank account is recovered from the posting journal.
    expect(input.bankAccountLabel).toEqual(expect.any(String));

    const bound = await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: receipt.id } });
    const file = await prisma.platformFile.findUniqueOrThrow({ where: { id: bound.documentFileId! } });
    expect(file).toMatchObject({ lifecycle: 'IMMUTABLE', status: 'READY', mimeType: 'application/pdf' });

    // A later allocation and a branding change: the receipt as issued does not change.
    await svc.customerReceiptService.allocate(env.identity, {
      receiptId: receipt.id,
      clientInvoiceId: b.id,
      amount: 500,
      arAccountCode: env.accounts.arCode,
      unappliedAccountCode: env.accounts.unaplCode,
    });
    await prisma.organization.update({ where: { id: env.orgId }, data: { invoiceFooterNote: 'Changed.' } });

    const again = await run(() => documents.getOrGenerateReceiptDocument(me, receipt.id));
    expect(again.url).toBe(first.url);
    const bytes = await run(() => documents.getOrGenerateReceiptPdf(me, receipt.id));
    expect(bytes).toMatchObject({ mimeType: 'application/pdf', filename: `${receipt.receiptNumber}.pdf` });
    expect(bytes.bytes.length).toBeGreaterThan(0);
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect((await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).documentFileId).toBe(file.id);

    // The download is gated by the receipt permission (file owner RECEIPT_DOCUMENT).
    await expect(run(() => documents.getOrGenerateReceiptDocument({ ...me, permissions: [] }, receipt.id))).rejects.toThrow(
      /do not have access/,
    );
  });
});

describe('RCP-03 concurrent first requests', () => {
  it('bind one document and discard the loser', async () => {
    const { receipt } = await postedReceipt();
    const [x, y] = await Promise.all([
      run(() => documents.getOrGenerateReceiptDocument(me, receipt.id)),
      run(() => documents.getOrGenerateReceiptDocument(me, receipt.id)),
    ]);
    expect(x.url).toBe(y.url);
    const bound = await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: receipt.id } });
    const pdfs = await prisma.platformFile.findMany({ where: { organizationId: env.orgId, originalName: `${receipt.receiptNumber}.pdf` } });
    expect(pdfs.map((f) => f.id)).toEqual([bound.documentFileId]);
  });
});

describe('RCP-04 send by WhatsApp', () => {
  it('records one RECEIPT message with the PDF attached; a repeat returns it without sending again', async () => {
    const { receipt } = await postedReceipt();
    const key = randomUUID();

    const sent = await run(() => sender.send(me, receipt.id, { idempotencyKey: key }));
    expect(sent).toMatchObject({
      status: 'SENT',
      channel: 'WHATSAPP',
      purpose: 'RECEIPT',
      resourceType: 'payment_receipt',
      resourceId: receipt.id,
      clientId: env.clientId,
      recipient: '+252615555555',
      templateName: 'rukna_receipt',
    });
    expect(whatsapp.uploadMedia).toHaveBeenCalledWith(expect.any(Buffer), 'application/pdf', `${receipt.receiptNumber}.pdf`);
    const call = whatsapp.sendTemplate.mock.calls[0][0];
    expect(call.bodyParams).toEqual(['Hodan Construction Ltd', receipt.receiptNumber, 'USD 5,000.00', expect.stringMatching(/^\d{2} \w{3} \d{4}$/), 'ACCO Ltd']);
    expect(call.document).toEqual({ mediaId: 'MEDIA-1', filename: `${receipt.receiptNumber}.pdf` });

    const repeat = await run(() => sender.send(me, receipt.id, { idempotencyKey: key }));
    expect(repeat.id).toBe(sent.id);
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    const rows = await prisma.outboundMessage.findMany({ where: { organizationId: env.orgId, resourceId: receipt.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].idempotencyKey).toBe(`receipt-send:${receipt.id}:${key}`);

    // A new key is a new message, to a typed number.
    const second = await run(() => sender.send(me, receipt.id, { recipient: '+252 61 234 5678', idempotencyKey: randomUUID() }));
    expect(second.recipient).toBe('+252612345678');
    expect(await prisma.outboundMessage.count({ where: { organizationId: env.orgId, resourceId: receipt.id } })).toBe(2);
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });
});

describe('RCP-05 preview', () => {
  it('lists the contact, the exact message, and is sendable', async () => {
    const { receipt } = await postedReceipt();
    const preview = await run(() => sender.preview(me, receipt.id));
    expect(preview).toMatchObject({
      templateConfigured: true,
      whatsappConfigured: true,
      recipients: [{ name: 'Amina', role: 'Finance', number: '+252615555555', isPrimary: true, source: 'whatsapp' }],
      defaultRecipient: '+252615555555',
      filename: `${receipt.receiptNumber}.pdf`,
      sendable: true,
      blockedReason: null,
    });
    expect(preview.message).toContain(`Your receipt ${receipt.receiptNumber} from ACCO Ltd is attached.`);
    expect(preview.message).toContain('USD 5,000.00');
  });
});

describe('RCP-06 commercial "record payment" receipt', () => {
  it('createAndPost receipts get the same document (bank account taken from the receipt)', async () => {
    const inv = await postedInvoice(800);
    const { receiptId } = await prisma.$transaction((tx) =>
      svc.customerReceiptService.createAndPost(
        env.identity,
        {
          clientId: env.clientId,
          bankAccountId: env.bankAccountId,
          bankAccountCode: env.accounts.bankCode,
          receiptDate: env.periods.openStart.toISOString().slice(0, 10),
          amount: '800',
          currency: 'USD',
          paymentMethod: 'Cheque',
          allocations: [{ clientInvoiceId: inv.id, amount: 800 }],
        },
        tx,
      ),
    );
    await run(() => documents.getOrGenerateReceiptDocument(me, receiptId));
    const input = renderSpy.mock.calls[0][0];
    expect(input).toMatchObject({ totalAmount: '800.00', unallocatedAmount: '0.00', paymentMethod: 'Cheque' });
    expect(input.allocations).toHaveLength(1);
    expect(input.bankAccountLabel).toEqual(expect.any(String));
  });
});
