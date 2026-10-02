import { ClientStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_CLIENT_FORM,
  toClientFormValues,
  toCreateClientPayload,
  toUpdateClientPayload,
  type ClientFormValues,
} from './client-form-payload';
import type { Client } from './types';

const filled: ClientFormValues = {
  ...EMPTY_CLIENT_FORM,
  name: '  Baraka   Real Estate ',
  type: 'COMPANY',
  registrationNumber: ' BL-2201 ',
  taxNumber: 'SO123',
  contactName: 'Yusuf  Ahmed',
  contactRole: 'Commercial Director',
  contactPhone: { country: 'SO', number: '61 234 5678' },
  contactEmail: ' Yusuf@Baraka.SO ',
  city: 'Mogadishu',
  address: 'Maka Al Mukarama Road',
  invoiceEmail: 'Accounts@Baraka.so',
  paymentTermsDays: '30',
};

describe('toCreateClientPayload', () => {
  it('sends E.164 phones, normalised names and emails, and omits blanks', () => {
    expect(toCreateClientPayload(filled)).toEqual({
      name: 'Baraka Real Estate',
      type: 'COMPANY',
      countryCode: 'SO',
      registrationNumber: 'BL-2201',
      taxNumber: 'SO123',
      city: 'Mogadishu',
      address: 'Maka Al Mukarama Road',
      invoiceEmail: 'accounts@baraka.so',
      paymentTermsDays: 30,
      primaryContact: {
        name: 'Yusuf Ahmed',
        role: 'Commercial Director',
        phone: '+252612345678',
        whatsappPhone: '+252612345678',
        email: 'yusuf@baraka.so',
      },
    });
  });

  it('sends a separate WhatsApp number, or none, when "same" is off', () => {
    const separate = toCreateClientPayload({
      ...filled,
      whatsappSame: false,
      contactWhatsapp: { country: 'SO', number: '61 666 6666' },
    });
    expect(separate.primaryContact.whatsappPhone).toBe('+252616666666');
    const none = toCreateClientPayload({ ...filled, whatsappSame: false });
    expect(none.primaryContact).not.toHaveProperty('whatsappPhone');
  });

  it('drops the job title for an individual', () => {
    const payload = toCreateClientPayload({ ...filled, type: 'INDIVIDUAL' });
    expect(payload.primaryContact).not.toHaveProperty('role');
  });

  it('omits every empty optional', () => {
    const payload = toCreateClientPayload({
      ...EMPTY_CLIENT_FORM,
      name: 'Hodan',
      contactName: 'Amina',
      contactPhone: { country: 'SO', number: '612345678' },
    });
    expect(payload).toEqual({
      name: 'Hodan',
      type: 'COMPANY',
      countryCode: 'SO',
      primaryContact: { name: 'Amina', phone: '+252612345678', whatsappPhone: '+252612345678' },
    });
  });
});

describe('toUpdateClientPayload', () => {
  it('sends null for cleared fields and no contact or status', () => {
    const payload = toUpdateClientPayload({ ...filled, taxNumber: ' ', invoiceEmail: '', paymentTermsDays: '' });
    expect(payload).toEqual({
      name: 'Baraka Real Estate',
      type: 'COMPANY',
      registrationNumber: 'BL-2201',
      taxNumber: null,
      countryCode: 'SO',
      city: 'Mogadishu',
      address: 'Maka Al Mukarama Road',
      invoiceEmail: null,
      paymentTermsDays: null,
      notes: null,
    });
  });
});

describe('toClientFormValues', () => {
  it('fills the form from a client, nulls as empty strings', () => {
    const client: Client = {
      id: 'c1',
      organizationId: 'o1',
      code: 'CLI-000001',
      name: 'Hodan Holdings',
      type: 'NGO',
      taxNumber: null,
      defaultCurrency: 'USD',
      status: ClientStatus.ACTIVE,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      paymentTermsDays: 0,
      countryCode: 'KE',
      city: null,
    };
    const values = toClientFormValues(client);
    expect(values.type).toBe('NGO');
    expect(values.paymentTermsDays).toBe('0');
    expect(values.countryCode).toBe('KE');
    expect(values.city).toBe('');
    expect(values.taxNumber).toBe('');
  });

  it('uses an individual client’s full name as the contact name', () => {
    const payload = toCreateClientPayload({ ...filled, type: 'INDIVIDUAL', name: 'Faadumo  Cali', contactName: '' });
    expect(payload.primaryContact.name).toBe('Faadumo Cali');
  });
});
