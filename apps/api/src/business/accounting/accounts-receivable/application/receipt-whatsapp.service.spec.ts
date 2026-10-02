import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

import { ReceiptWhatsAppService, receiptTemplateParams } from './receipt-whatsapp.service';

const identity: RequestIdentity = {
  userId: 'u1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: ['manage:receivable'],
};

const receiptRow = (over: Record<string, unknown> = {}) => ({
  id: 'rcp-1',
  clientId: 'client-1',
  postingStatus: 'POSTED',
  receiptNumber: 'RCP-000017',
  totalAmount: new Decimal('5000'),
  currencyCode: 'USD',
  receiptDate: new Date('2026-10-02T00:00:00Z'),
  client: {
    name: 'Hodan Construction Ltd',
    countryCode: 'SO',
    contacts: [
      { id: 'k1', name: 'Amina', role: 'Finance', phone: null, whatsappPhone: '+252615555555', isPrimary: true },
      { id: 'k2', name: 'Omar', role: null, phone: '+252612345678', whatsappPhone: null, isPrimary: false },
    ],
  },
  organization: { name: 'ACCO Ltd' },
  ...over,
});

function build(opts: { receipt?: unknown; template?: string | null; whatsapp?: boolean } = {}) {
  const repo = { findForDocument: jest.fn().mockResolvedValue(opts.receipt === undefined ? receiptRow() : opts.receipt) };
  const documents = {
    getOrGenerateReceiptPdf: jest
      .fn()
      .mockResolvedValue({ bytes: Buffer.from('%PDF'), mimeType: 'application/pdf', filename: 'RCP-000017.pdf' }),
  };
  const communication = { sendWhatsAppTemplate: jest.fn().mockResolvedValue({ id: 'msg-1', status: 'SENT' }) };
  const whatsapp = { isConfigured: jest.fn().mockReturnValue(opts.whatsapp ?? true) };
  const env: Record<string, string | undefined> = {
    WHATSAPP_TEMPLATE_RECEIPT: opts.template === undefined ? 'rukna_receipt' : (opts.template ?? undefined),
  };
  const config = { get: (key: string) => env[key] };
  const service = new ReceiptWhatsAppService(
    { getClient: () => ({}) } as never,
    repo as never,
    documents as never,
    communication as never,
    whatsapp as never,
    config as never,
  );
  return { service, repo, documents, communication, whatsapp };
}

describe('receiptTemplateParams', () => {
  it('fills rukna_receipt {{1}}..{{5}}: client, receipt number, amount, payment date, company', () => {
    expect(
      receiptTemplateParams({
        clientName: 'Hodan Construction Ltd',
        receiptNumber: 'RCP-000017',
        totalAmount: new Decimal('5000'),
        currencyCode: 'USD',
        receiptDate: new Date('2026-10-02T00:00:00Z'),
        orgName: 'ACCO Ltd',
      }),
    ).toEqual(['Hodan Construction Ltd', 'RCP-000017', 'USD 5,000.00', '02 Oct 2026', 'ACCO Ltd']);
  });
});

describe('ReceiptWhatsAppService.preview', () => {
  it('a posted receipt with a contact and full set-up is sendable to the primary contact', async () => {
    const { service } = build();
    const preview = await service.preview(identity, 'rcp-1');
    expect(preview).toEqual({
      templateConfigured: true,
      whatsappConfigured: true,
      recipients: [
        { contactId: 'k1', name: 'Amina', role: 'Finance', number: '+252615555555', isPrimary: true, source: 'whatsapp' },
        { contactId: 'k2', name: 'Omar', role: null, number: '+252612345678', isPrimary: false, source: 'phone' },
      ],
      defaultRecipient: '+252615555555',
      message:
        'Hello Hodan Construction Ltd, thank you for your payment of USD 5,000.00 received on 02 Oct 2026. Your receipt RCP-000017 from ACCO Ltd is attached.',
      filename: 'RCP-000017.pdf',
      sendable: true,
      blockedReason: null,
    });
  });

  it.each([
    ['NOT_POSTED', { receipt: receiptRow({ postingStatus: 'NOT_POSTED', receiptNumber: null }) }],
    ['NOT_POSTED', { receipt: receiptRow({ postingStatus: 'REVERSED' }) }],
    ['NO_RECIPIENT', { receipt: receiptRow({ client: { name: 'X', countryCode: 'SO', contacts: [] } }) }],
    ['TEMPLATE_NOT_CONFIGURED', { template: null }],
    ['WHATSAPP_NOT_CONFIGURED', { whatsapp: false }],
  ] as const)('blocked: %s', async (reason, opts) => {
    const { service } = build(opts as never);
    const preview = await service.preview(identity, 'rcp-1');
    expect(preview.blockedReason).toBe(reason);
    expect(preview.sendable).toBe(false);
  });

  it('404s an unknown receipt', async () => {
    const { service } = build({ receipt: null });
    await expect(service.preview(identity, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ReceiptWhatsAppService.send', () => {
  it('sends the receipt PDF with the RECEIPT template to the default recipient, key namespaced to the receipt', async () => {
    const { service, communication } = build();
    await expect(service.send(identity, 'rcp-1', { idempotencyKey: 'k-1' })).resolves.toEqual({ id: 'msg-1', status: 'SENT' });
    expect(communication.sendWhatsAppTemplate).toHaveBeenCalledWith(identity, {
      purpose: 'RECEIPT',
      clientId: 'client-1',
      recipient: '+252615555555',
      resourceType: 'payment_receipt',
      resourceId: 'rcp-1',
      templateName: 'rukna_receipt',
      language: 'en',
      bodyParams: ['Hodan Construction Ltd', 'RCP-000017', 'USD 5,000.00', '02 Oct 2026', 'ACCO Ltd'],
      document: { bytes: Buffer.from('%PDF'), mimeType: 'application/pdf', filename: 'RCP-000017.pdf' },
      idempotencyKey: 'receipt-send:rcp-1:k-1',
    });
  });

  it('sends to a typed number, normalised to E.164', async () => {
    const { service, communication } = build();
    await service.send(identity, 'rcp-1', { recipient: '+252 61 999 8888', idempotencyKey: 'k' });
    expect(communication.sendWhatsAppTemplate.mock.calls[0][1].recipient).toBe('+252619998888');
  });

  it('refuses an invalid typed number without sending', async () => {
    const { service, communication, documents } = build();
    await expect(service.send(identity, 'rcp-1', { recipient: '0612345678', idempotencyKey: 'k' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(documents.getOrGenerateReceiptPdf).not.toHaveBeenCalled();
    expect(communication.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it.each([
    ['NOT_POSTED', ConflictException, { receipt: receiptRow({ postingStatus: 'NOT_POSTED', receiptNumber: null }) }],
    ['TEMPLATE_NOT_CONFIGURED', BadRequestException, { template: null }],
    ['WHATSAPP_NOT_CONFIGURED', BadRequestException, { whatsapp: false }],
    ['NO_RECIPIENT', BadRequestException, { receipt: receiptRow({ client: { name: 'X', countryCode: 'SO', contacts: [] } }) }],
  ] as const)('refuses %s without sending', async (code, type, opts) => {
    const { service, communication } = build(opts as never);
    const error = await service.send(identity, 'rcp-1', { idempotencyKey: 'k' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(type);
    expect((error as { getResponse(): { errorCode: string } }).getResponse().errorCode).toBe(code);
    expect(communication.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });
});
