import { BadRequestException } from '@nestjs/common';
import {
  defaultWhatsAppRecipient,
  formatMessageAmount,
  formatMessageDate,
  normaliseWhatsAppRecipient,
  renderWhatsAppMessage,
  whatsappRecipientOptions,
  whatsappSendBlockedReason,
  type ContactForRecipient,
} from './whatsapp-send-preview';

const contact = (over: Partial<ContactForRecipient>): ContactForRecipient => ({
  id: 'c',
  name: 'Contact',
  role: null,
  phone: null,
  whatsappPhone: null,
  isPrimary: false,
  ...over,
});

describe('WhatsApp send preview helpers', () => {
  it('formats amounts as the templates expect, without float rounding', () => {
    expect(formatMessageAmount('5000', 'USD')).toBe('USD 5,000.00');
    expect(formatMessageAmount('1234567.5', 'USD')).toBe('USD 1,234,567.50');
    expect(formatMessageAmount('9999999999999999.99', 'USD')).toBe('USD 9,999,999,999,999,999.99');
    expect(formatMessageAmount({ toFixed: () => '12.30' }, 'SOS')).toBe('SOS 12.30');
    expect(formatMessageAmount('0', 'USD')).toBe('USD 0.00');
  });

  it('formats dates as "02 Oct 2026", read in UTC', () => {
    expect(formatMessageDate(new Date('2026-10-02T00:00:00Z'))).toBe('02 Oct 2026');
    expect(formatMessageDate(new Date('2026-01-31T23:30:00Z'))).toBe('31 Jan 2026');
  });

  it('fills the receipt template body by position', () => {
    expect(renderWhatsAppMessage('RECEIPT', ['Hodan', 'RCP-000017', 'USD 5,000.00', '02 Oct 2026', 'ACCO Ltd'])).toBe(
      'Hello Hodan, thank you for your payment of USD 5,000.00 received on 02 Oct 2026. Your receipt RCP-000017 from ACCO Ltd is attached.',
    );
  });

  it('builds recipients: WhatsApp number preferred, phone as fallback, unusable numbers dropped, primary first', () => {
    const options = whatsappRecipientOptions(
      [
        contact({ id: 'a', name: 'Zed', phone: '+252612345678' }),
        contact({ id: 'b', name: 'Amina', whatsappPhone: '+252615555555', phone: '+252612222222', isPrimary: true, role: 'Finance' }),
        contact({ id: 'c', name: 'Bad', phone: 'call the office' }),
        contact({ id: 'd', name: 'Local', phone: '061 333 4444' }), // pre-redesign row, no country code
        contact({ id: 'e', name: 'Nobody' }),
      ],
      'SO',
    );
    expect(options).toEqual([
      { contactId: 'b', name: 'Amina', role: 'Finance', number: '+252615555555', isPrimary: true, source: 'whatsapp' },
      { contactId: 'd', name: 'Local', role: null, number: '+252613334444', isPrimary: false, source: 'phone' },
      { contactId: 'a', name: 'Zed', role: null, number: '+252612345678', isPrimary: false, source: 'phone' },
    ]);
    expect(defaultWhatsAppRecipient(options)).toBe('+252615555555');
    expect(defaultWhatsAppRecipient(options.slice(1))).toBe('+252613334444');
    expect(defaultWhatsAppRecipient([])).toBeNull();
  });

  it('blocked reason: record first, then recipient, then template, then WhatsApp connection', () => {
    const ok = { posted: true, hasRecipient: true, templateConfigured: true, whatsappConfigured: true };
    expect(whatsappSendBlockedReason(ok)).toBeNull();
    expect(whatsappSendBlockedReason({ ...ok, posted: false, reversed: true, hasRecipient: false })).toBe('REVERSED');
    expect(whatsappSendBlockedReason({ ...ok, posted: false, hasRecipient: false, templateConfigured: false })).toBe('NOT_POSTED');
    expect(whatsappSendBlockedReason({ ...ok, hasRecipient: false, templateConfigured: false })).toBe('NO_RECIPIENT');
    expect(whatsappSendBlockedReason({ ...ok, templateConfigured: false, whatsappConfigured: false })).toBe('TEMPLATE_NOT_CONFIGURED');
    expect(whatsappSendBlockedReason({ ...ok, whatsappConfigured: false })).toBe('WHATSAPP_NOT_CONFIGURED');
  });

  it('normalises a typed recipient to E.164 and refuses anything else', () => {
    expect(normaliseWhatsAppRecipient(' +252 61 234 5678 ')).toBe('+252612345678');
    for (const bad of ['0612345678', '+2526', 'hello', '', 42, null, `+${'1'.repeat(40)}`]) {
      expect(() => normaliseWhatsAppRecipient(bad)).toThrow(BadRequestException);
    }
  });
});
