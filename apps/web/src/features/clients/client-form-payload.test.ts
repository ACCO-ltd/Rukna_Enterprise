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
  code: 'CL-001',
  name: 'Baraka Real Estate',
  nameAr: 'شركة البركة',
  taxNumber: 'SO-123456',
  defaultCurrency: 'USD',
};

describe('toCreateClientPayload', () => {
  it('sends every filled field, trimmed', () => {
    expect(toCreateClientPayload({ ...filled, code: '  CL-001  ' })).toEqual({
      code: 'CL-001',
      name: 'Baraka Real Estate',
      nameAr: 'شركة البركة',
      taxNumber: 'SO-123456',
      defaultCurrency: 'USD',
    });
  });

  // An empty string is not "absent": `defaultCurrency` carries @Length(3, 3), so "" is an
  // invalid code and the request 400s. And a blank tax number should be NULL, not "".
  it('omits empty optional fields rather than sending empty strings', () => {
    const payload = toCreateClientPayload({
      ...EMPTY_CLIENT_FORM,
      code: 'CL-002',
      name: 'Minimal Client',
    });

    expect(payload).toEqual({ code: 'CL-002', name: 'Minimal Client' });
    expect(payload).not.toHaveProperty('defaultCurrency');
    expect(payload).not.toHaveProperty('taxNumber');
    expect(payload).not.toHaveProperty('nameAr');
  });

  it('treats a whitespace-only optional field as empty', () => {
    const payload = toCreateClientPayload({ ...EMPTY_CLIENT_FORM, code: 'C', name: 'N', taxNumber: '   ' });
    expect(payload).not.toHaveProperty('taxNumber');
  });

  // api-reference.md documents `status` in the create body, but CreateClientDto does not
  // declare it and the API runs forbidNonWhitelisted — sending it is a 400 (D3).
  it('never sends status', () => {
    expect(toCreateClientPayload(filled)).not.toHaveProperty('status');
  });
});

describe('toUpdateClientPayload', () => {
  it('sends every filled field, trimmed', () => {
    expect(toUpdateClientPayload(filled)).toEqual({
      name: 'Baraka Real Estate',
      nameAr: 'شركة البركة',
      taxNumber: 'SO-123456',
      defaultCurrency: 'USD',
    });
  });

  // On a PATCH, omitting means "leave unchanged" — so clearing a field has to be an
  // explicit null, or every optional field would be write-once.
  it('sends null for a cleared field so it can actually be cleared', () => {
    expect(toUpdateClientPayload({ ...filled, taxNumber: '', defaultCurrency: '' })).toEqual({
      name: 'Baraka Real Estate',
      nameAr: 'شركة البركة',
      taxNumber: null,
      defaultCurrency: null,
    });
  });

  it('never sends code, which is immutable after creation', () => {
    expect(toUpdateClientPayload(filled)).not.toHaveProperty('code');
  });

  // Deactivating is a separate, deliberate action — it must not ride along with a typo fix.
  it('never sends status', () => {
    expect(toUpdateClientPayload(filled)).not.toHaveProperty('status');
  });
});

describe('toClientFormValues', () => {
  it('converts nulls to the empty strings inputs need', () => {
    const client: Client = {
      id: 'c1',
      organizationId: 'org1',
      code: 'CL-001',
      name: 'Baraka',
      nameAr: null,
      taxNumber: null,
      defaultCurrency: null,
      status: ClientStatus.ACTIVE,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(toClientFormValues(client)).toEqual({
      code: 'CL-001',
      name: 'Baraka',
      nameAr: '',
      taxNumber: '',
      defaultCurrency: '',
    });
  });

  it('round-trips a fully populated client', () => {
    const client: Client = {
      id: 'c1',
      organizationId: 'org1',
      code: 'CL-001',
      name: 'Baraka',
      nameAr: 'البركة',
      taxNumber: 'SO-1',
      defaultCurrency: 'USD',
      status: ClientStatus.ACTIVE,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(toUpdateClientPayload(toClientFormValues(client))).toEqual({
      name: 'Baraka',
      nameAr: 'البركة',
      taxNumber: 'SO-1',
      defaultCurrency: 'USD',
    });
  });
});
