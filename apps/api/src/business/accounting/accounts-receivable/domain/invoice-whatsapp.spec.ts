import {
  INVOICE_TEMPLATE_BODY,
  buildInvoiceBodyParams,
  defaultRecipient,
  formatTemplateDate,
  formatTemplateMoney,
  isE164,
  isIssuedForSending,
  recipientOptions,
  renderTemplateBody,
  whatsAppBlockedReason,
  type ContactNumbers,
} from './invoice-whatsapp';

const contact = (over: Partial<ContactNumbers>): ContactNumbers => ({
  id: 'c1',
  name: 'Hodan',
  role: null,
  phone: null,
  whatsappPhone: null,
  isPrimary: false,
  ...over,
});

describe('invoice WhatsApp template values', () => {
  it('formats money with its currency, grouped, 2dp, without floating point', () => {
    expect(formatTemplateMoney('12500', 'USD')).toBe('USD 12,500.00');
    expect(formatTemplateMoney('12500.5', 'USD')).toBe('USD 12,500.50');
    expect(formatTemplateMoney('1234567890123.45', 'SOS')).toBe('SOS 1,234,567,890,123.45');
    expect(formatTemplateMoney('0.00', 'USD')).toBe('USD 0.00');
    expect(formatTemplateMoney('999.99', 'USD')).toBe('USD 999.99');
  });

  it('formats a calendar date as 15 Oct 2026 in UTC, and no due date as "receipt"', () => {
    expect(formatTemplateDate(new Date('2026-10-15T00:00:00Z'))).toBe('15 Oct 2026');
    expect(formatTemplateDate(new Date('2026-09-01T00:00:00Z'))).toBe('01 Sep 2026');
    expect(formatTemplateDate(null)).toBe('receipt');
  });

  it('builds {{1}}…{{5}} in template order and renders the body', () => {
    const params = buildInvoiceBodyParams({
      clientName: ' Hodan Construction Ltd ',
      invoiceNumber: 'INV-000042',
      totalAmount: '12500.00',
      currencyCode: 'USD',
      dueDate: new Date('2026-10-15T00:00:00Z'),
      companyName: 'ACCO Ltd',
    });
    expect(params).toEqual([
      'Hodan Construction Ltd',
      'INV-000042',
      'USD 12,500.00',
      '15 Oct 2026',
      'ACCO Ltd',
    ]);
    expect(renderTemplateBody(INVOICE_TEMPLATE_BODY, params)).toBe(
      'Hello Hodan Construction Ltd, please find attached invoice INV-000042 from ACCO Ltd for USD 12,500.00, due on 15 Oct 2026. If you have any questions about this invoice, reply to this message. Thank you.',
    );
  });
});

describe('recipients', () => {
  it('accepts only valid E.164 numbers', () => {
    expect(isE164('+252612345678')).toBe(true);
    expect(isE164('252612345678')).toBe(false);
    expect(isE164('+25261')).toBe(false);
    expect(isE164('0612345678')).toBe(false);
    expect(isE164(null)).toBe(false);
  });

  it('prefers a contact WhatsApp number over its phone, skips unusable numbers, primary first', () => {
    const options = recipientOptions([
      contact({ id: 'a', name: 'A', phone: '+252612345678' }),
      contact({
        id: 'b',
        name: 'B',
        whatsappPhone: '+252615555555',
        phone: '+252612222222',
        isPrimary: true,
      }),
      contact({ id: 'c', name: 'C', phone: '061 234' }),
      contact({ id: 'd', name: 'D', whatsappPhone: 'bad', phone: '+252613333333' }),
    ]);
    expect(options.map((o) => [o.contactId, o.number, o.source])).toEqual([
      ['b', '+252615555555', 'whatsapp'],
      ['a', '+252612345678', 'phone'],
      ['d', '+252613333333', 'phone'],
    ]);
    expect(defaultRecipient(options)).toBe('+252615555555');
  });

  it('defaults to the first saved number without a primary, and null with none', () => {
    const options = recipientOptions([contact({ id: 'a', phone: '+252612345678' })]);
    expect(defaultRecipient(options)).toBe('+252612345678');
    expect(defaultRecipient([])).toBeNull();
  });
});

describe('blocked reasons', () => {
  const ok = {
    issued: true,
    whatsappConfigured: true,
    templateConfigured: true,
    recipient: '+252612345678',
  };

  it('is null when everything is in place', () => {
    expect(whatsAppBlockedReason(ok)).toBeNull();
  });

  it('checks the record, then the number, then the server set-up', () => {
    expect(
      whatsAppBlockedReason({ ...ok, issued: false, whatsappConfigured: false, recipient: null }),
    ).toBe('NOT_POSTED');
    expect(whatsAppBlockedReason({ ...ok, templateConfigured: false, recipient: null })).toBe(
      'NO_RECIPIENT',
    );
    expect(
      whatsAppBlockedReason({ ...ok, whatsappConfigured: false, templateConfigured: false }),
    ).toBe('TEMPLATE_NOT_CONFIGURED');
    expect(whatsAppBlockedReason({ ...ok, whatsappConfigured: false })).toBe(
      'WHATSAPP_NOT_CONFIGURED',
    );
  });

  it('an invoice is issued only when numbered, posted and not cancelled', () => {
    expect(
      isIssuedForSending({
        invoiceNumber: 'INV-1',
        postingStatus: 'POSTED',
        documentStatus: 'APPROVED',
      }),
    ).toBe(true);
    expect(
      isIssuedForSending({
        invoiceNumber: null,
        postingStatus: 'POSTED',
        documentStatus: 'APPROVED',
      }),
    ).toBe(false);
    expect(
      isIssuedForSending({
        invoiceNumber: 'INV-1',
        postingStatus: 'NOT_POSTED',
        documentStatus: 'APPROVED',
      }),
    ).toBe(false);
    expect(
      isIssuedForSending({
        invoiceNumber: 'INV-1',
        postingStatus: 'REVERSED',
        documentStatus: 'APPROVED',
      }),
    ).toBe(false);
    expect(
      isIssuedForSending({
        invoiceNumber: 'INV-1',
        postingStatus: 'POSTED',
        documentStatus: 'CANCELLED',
      }),
    ).toBe(false);
  });
});
