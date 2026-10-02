import type { OutboundMessageView, RequestIdentity } from '@erp/types';

import { InvoiceWhatsAppService } from './invoice-whatsapp.service';

const identity: RequestIdentity = {
  userId: 'u1',
  activeOrganizationId: 'org1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'inv1',
  organizationId: 'org1',
  clientId: 'cl1',
  invoiceNumber: 'INV-000042',
  postingStatus: 'POSTED',
  documentStatus: 'APPROVED',
  currencyCode: 'USD',
  totalAmount: '12500.00',
  dueDate: new Date('2026-10-15T00:00:00Z'),
  billingAddressSnapshot: { client: { name: 'Hodan Construction Ltd' }, org: { name: 'ACCO Ltd' } },
  ...over,
});

const message = (over: Partial<OutboundMessageView> = {}): OutboundMessageView => ({
  id: 'm1',
  channel: 'WHATSAPP',
  purpose: 'INVOICE',
  clientId: 'cl1',
  recipient: '+252615555555',
  resourceType: 'client_invoice',
  resourceId: 'inv1',
  templateName: 'rukna_invoice',
  templateLanguage: 'en',
  status: 'SENT',
  queuedAt: '2026-10-02T10:00:00.000Z',
  sentAt: '2026-10-02T10:00:01.000Z',
  deliveredAt: null,
  readAt: null,
  failedAt: null,
  errorCode: null,
  errorMessage: null,
  createdBy: 'u1',
  createdAt: '2026-10-02T10:00:00.000Z',
  ...over,
});

function setup(
  opts: {
    env?: Record<string, string>;
    configured?: boolean;
    inv?: Record<string, unknown>;
    contacts?: unknown[];
  } = {},
) {
  const env: Record<string, string> = opts.env ?? { WHATSAPP_TEMPLATE_INVOICE: 'rukna_invoice' };
  const repo = {
    findInvoice: jest.fn().mockResolvedValue(invoice(opts.inv)),
    findClientName: jest.fn().mockResolvedValue('Live Client'),
    findOrganizationName: jest.fn().mockResolvedValue('Live Org'),
    listContacts: jest.fn().mockResolvedValue(
      opts.contacts ?? [
        {
          id: 'k1',
          name: 'Ali',
          role: 'Accounts',
          phone: '+252612345678',
          whatsappPhone: null,
          isPrimary: false,
        },
        {
          id: 'k2',
          name: 'Hodan',
          role: 'Director',
          phone: '+252612222222',
          whatsappPhone: '+252615555555',
          isPrimary: true,
        },
      ],
    ),
    recordMessageDelivery: jest.fn().mockResolvedValue(true),
  };
  const communication = {
    onResolvedAsSent: jest.fn(),
    sendWhatsAppTemplate: jest.fn().mockResolvedValue(message()),
  };
  const invoices = { readDocumentBytes: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7')) };
  const service = new InvoiceWhatsAppService(
    { getClient: () => ({}) } as never,
    { get: (key: string) => env[key] } as never,
    { isConfigured: () => opts.configured ?? true } as never,
    communication as never,
    invoices as never,
    repo as never,
  );
  return { service, repo, communication, invoices };
}

describe('InvoiceWhatsAppService.preview', () => {
  it('fills the message from the invoice snapshot and defaults to the primary contact', async () => {
    const { service } = setup();
    const preview = await service.preview(identity, 'inv1');
    expect(preview).toMatchObject({
      templateConfigured: true,
      whatsappConfigured: true,
      defaultRecipient: '+252615555555',
      filename: 'INV-000042.pdf',
      sendable: true,
      blockedReason: null,
    });
    expect(preview.recipients.map((r) => r.contactId)).toEqual(['k2', 'k1']);
    expect(preview.message).toContain(
      'Hello Hodan Construction Ltd, please find attached invoice INV-000042 from ACCO Ltd for USD 12,500.00, due on 15 Oct 2026.',
    );
  });

  it('falls back to the live client / org names for an invoice without a snapshot', async () => {
    const { service } = setup({ inv: { billingAddressSnapshot: {} } });
    expect((await service.preview(identity, 'inv1')).message).toMatch(
      /^Hello Live Client, .* from Live Org /,
    );
  });

  it.each([
    [{ inv: { postingStatus: 'NOT_POSTED', invoiceNumber: null } }, 'NOT_POSTED'],
    [{ configured: false }, 'WHATSAPP_NOT_CONFIGURED'],
    [{ env: {} }, 'TEMPLATE_NOT_CONFIGURED'],
    [{ contacts: [] }, 'NO_RECIPIENT'],
  ])('explains a blocked send (%o → %s)', async (opts, reason) => {
    const { service } = setup(opts);
    const preview = await service.preview(identity, 'inv1');
    expect(preview.sendable).toBe(false);
    expect(preview.blockedReason).toBe(reason);
  });
});

describe('InvoiceWhatsAppService.send', () => {
  it('sends the template with the PDF to the default recipient and records the delivery', async () => {
    const { service, communication, repo } = setup();
    await service.send(identity, 'inv1', { idempotencyKey: 'abc' });
    expect(communication.sendWhatsAppTemplate).toHaveBeenCalledWith(identity, {
      purpose: 'INVOICE',
      clientId: 'cl1',
      recipient: '+252615555555',
      resourceType: 'client_invoice',
      resourceId: 'inv1',
      templateName: 'rukna_invoice',
      language: 'en',
      bodyParams: [
        'Hodan Construction Ltd',
        'INV-000042',
        'USD 12,500.00',
        '15 Oct 2026',
        'ACCO Ltd',
      ],
      document: {
        bytes: Buffer.from('%PDF-1.7'),
        mimeType: 'application/pdf',
        filename: 'INV-000042.pdf',
      },
      idempotencyKey: 'invoice-send:inv1:abc',
    });
    expect(repo.recordMessageDelivery).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        invoiceId: 'inv1',
        recipient: '+252615555555',
        outboundMessageId: 'm1',
        sentBy: 'u1',
      }),
    );
  });

  it('uses another number when given', async () => {
    const { service, communication } = setup();
    await service.send(identity, 'inv1', { recipient: ' +252613333333 ', idempotencyKey: 'abc' });
    expect(communication.sendWhatsAppTemplate.mock.calls[0][1].recipient).toBe('+252613333333');
  });

  it.each(['FAILED', 'UNKNOWN', 'QUEUED'] as const)(
    'records no delivery when the message is %s',
    async (status) => {
      const { service, communication, repo } = setup();
      communication.sendWhatsAppTemplate.mockResolvedValue(message({ status, sentAt: null }));
      const result = await service.send(identity, 'inv1', { idempotencyKey: 'abc' });
      expect(result.status).toBe(status);
      expect(repo.recordMessageDelivery).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{}, { recipient: '0612345678' }, 'RECIPIENT_INVALID', 400],
    [{ contacts: [] }, {}, 'NO_RECIPIENT', 400],
    [{ inv: { postingStatus: 'NOT_POSTED' } }, {}, 'NOT_POSTED', 409],
    [{ env: {} }, {}, 'TEMPLATE_NOT_CONFIGURED', 400],
    [{ configured: false }, {}, 'WHATSAPP_NOT_CONFIGURED', 400],
  ])('refuses in plain words (%o %o → %s)', async (opts, body, code, status) => {
    const { service, communication, invoices } = setup(opts);
    const error = await service
      .send(identity, 'inv1', { idempotencyKey: 'abc', ...body })
      .catch((e: unknown) => e);
    expect((error as { getStatus(): number }).getStatus()).toBe(status);
    expect(
      (error as { getResponse(): { errorCode: string; message: string } }).getResponse(),
    ).toMatchObject({
      errorCode: code,
      message: expect.any(String),
    });
    expect(communication.sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(invoices.readDocumentBytes).not.toHaveBeenCalled();
  });

  it('registers the resolve-as-sent hook for invoices, which records the delivery', async () => {
    const { service, communication, repo } = setup();
    service.onModuleInit();
    expect(communication.onResolvedAsSent).toHaveBeenCalledWith(
      'client_invoice',
      expect.any(Function),
    );
    const handler = communication.onResolvedAsSent.mock.calls[0][1];
    const tx = { tx: true };
    await handler(tx, identity, message({ id: 'm9' }));
    expect(repo.recordMessageDelivery).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ outboundMessageId: 'm9' }),
    );
  });
});
