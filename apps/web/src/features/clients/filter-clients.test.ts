import { ClientStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { filterClients, primaryContact } from './filter-clients';
import type { Client } from './types';

function client(overrides: Partial<Client> & { id: string }): Client {
  return {
    organizationId: 'org1',
    code: 'CL-001',
    name: 'Baraka Real Estate',
    taxNumber: null,
    defaultCurrency: null,
    status: ClientStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const ALL = { search: '', status: 'ALL' } as const;

describe('filterClients', () => {
  it('returns everything when nothing is filtered', () => {
    const clients = [client({ id: 'a' }), client({ id: 'b' })];
    expect(filterClients(clients, ALL)).toHaveLength(2);
  });

  it('filters by status', () => {
    const clients = [
      client({ id: 'a', status: ClientStatus.ACTIVE }),
      client({ id: 'b', status: ClientStatus.INACTIVE }),
    ];

    expect(filterClients(clients, { ...ALL, status: ClientStatus.INACTIVE })).toEqual([clients[1]]);
  });

  it.each([
    ['code', 'CL-042'],
    ['name', 'Hodan Holdings'],
    ['tax number', 'SO-99887'],
  ])('matches on %s', (_field, needle) => {
    const target = client({
      id: 'a',
      code: 'CL-042',
      name: 'Hodan Holdings',
      taxNumber: 'SO-99887',
    });
    const other = client({ id: 'b', code: 'CL-001', name: 'Other', taxNumber: 'SO-11111' });

    expect(filterClients([target, other], { ...ALL, search: needle })).toEqual([target]);
  });

  // Finance staff reconcile by tax number, and it is often the only identifier on the
  // document in front of them.
  it('matches a partial tax number', () => {
    const target = client({ id: 'a', taxNumber: 'SO-123456789' });
    expect(filterClients([target], { ...ALL, search: '4567' })).toEqual([target]);
  });


  it('ignores case and surrounding whitespace', () => {
    const target = client({ id: 'a', name: 'Baraka Real Estate' });
    expect(filterClients([target], { ...ALL, search: '  BARAKA  ' })).toEqual([target]);
  });

  it('applies search and status together', () => {
    const clients = [
      client({ id: 'a', name: 'Baraka', status: ClientStatus.ACTIVE }),
      client({ id: 'b', name: 'Baraka', status: ClientStatus.INACTIVE }),
    ];

    expect(
      filterClients(clients, { search: 'baraka', status: ClientStatus.ACTIVE }),
    ).toEqual([clients[0]]);
  });

  it('does not match a null field', () => {
    const target = client({ id: 'a', taxNumber: null });
    expect(filterClients([target], { ...ALL, search: 'null' })).toEqual([]);
  });
});

describe('primaryContact', () => {
  const contact = (id: string, isPrimary: boolean) => ({ id, isPrimary });

  it('prefers the contact flagged primary', () => {
    const contacts = [contact('a', false), contact('b', true)];
    expect(primaryContact(contacts)).toBe(contacts[1]);
  });

  // Nothing guarantees a client has a primary — one only exists if somebody ticked the
  // box — so falling back to the first is better than showing none.
  it('falls back to the first contact when none is flagged', () => {
    const contacts = [contact('a', false), contact('b', false)];
    expect(primaryContact(contacts)).toBe(contacts[0]);
  });

  it('returns null when there are no contacts', () => {
    expect(primaryContact([])).toBeNull();
  });
});
