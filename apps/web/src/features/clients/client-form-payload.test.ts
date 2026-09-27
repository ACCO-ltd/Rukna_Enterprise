import { ClientStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_CLIENT_FORM,
  toClientFormValues,
  toCreateClientPayload,
  toUpdateClientPayload,
} from './client-form-payload';
import type { Client } from './types';

describe('client form payloads', () => {

  it('keeps the server-generated code immutable on update, and sends tax ID and address', () => {
    expect(toUpdateClientPayload({
      ...EMPTY_CLIENT_FORM,
      name: 'Baraka',
      taxNumber: ' SO-123 ',
    })).toEqual({
      name: 'Baraka',
      type: 'COMPANY',
      taxNumber: 'SO-123',
      address: null,
      notes: null,
    });
  });

  it('sends tax ID and address on create, and omits them when blank', () => {
    expect(toCreateClientPayload({
      ...EMPTY_CLIENT_FORM,
      name: ' Baraka ',
      taxNumber: ' SO-123 ',
      address: ' KM4, Mogadishu ',
    })).toEqual({ name: 'Baraka', type: 'COMPANY', taxNumber: 'SO-123', address: 'KM4, Mogadishu' });

    const blank = toCreateClientPayload({ ...EMPTY_CLIENT_FORM, name: 'Baraka', taxNumber: '  ' });
    expect(blank).not.toHaveProperty('taxNumber');
    expect(blank).not.toHaveProperty('address');
  });

  it('initialises new contact fields while preserving existing client values', () => {
    const client: Client = {
      id: 'c1', organizationId: 'org1', code: 'CLI-000001', name: 'Baraka',
      taxNumber: null, defaultCurrency: null, status: ClientStatus.ACTIVE,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(toClientFormValues(client)).toMatchObject({
      name: 'Baraka', taxNumber: '', defaultCurrency: '',
      contactName: '', contactRole: '', contactPhone: '', contactEmail: '',
    });
  });
});
