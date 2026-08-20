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

  it('keeps the server-generated code immutable on update', () => {
    expect(toUpdateClientPayload({
      ...EMPTY_CLIENT_FORM,
      name: 'Baraka',
      taxNumber: ' SO-123 ',
    })).toEqual({
      name: 'Baraka',
      type: 'COMPANY',
      notes: null,
    });
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
