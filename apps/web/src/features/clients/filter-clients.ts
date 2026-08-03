import type { ClientStatus } from '@erp/types';

import type { Client } from './types';

export interface ClientFilters {
  search: string;
  status: ClientStatus | 'ALL';
}

/**
 * Filters the client list in the browser.
 *
 * Unlike projects — where `GET /projects` at least accepts a `status` parameter — the
 * clients endpoint takes no query parameters at all (D3), so every filter is client-side
 * by necessity rather than by choice. The full list is fetched once and cached; at ACCO's
 * scale a construction firm has tens of clients, not thousands.
 *
 * Search matches code, both names and the tax number. Including `taxNumber` is deliberate:
 * finance staff identify a client by tax number when reconciling an invoice, and it is
 * often the only field they have to hand.
 *
 * Both names are searched so an Arabic-named client is findable while the UI is in English
 * and vice versa.
 */
export function filterClients(clients: Client[], filters: ClientFilters): Client[] {
  const needle = filters.search.trim().toLowerCase();

  return clients.filter((client) => {
    if (filters.status !== 'ALL' && client.status !== filters.status) return false;
    if (!needle) return true;

    return [client.code, client.name, client.nameAr, client.taxNumber].some((field) =>
      field?.toLowerCase().includes(needle),
    );
  });
}

/**
 * The contact to show when there is only room for one.
 *
 * The API stores `isPrimary` but does not order contacts, and nothing guarantees a client
 * has a primary at all — one is only set when somebody ticks the box. So: the primary if
 * there is one, otherwise the first contact, otherwise nothing. Never an arbitrary pick
 * dressed up as "the" contact.
 */
export function primaryContact<T extends { isPrimary: boolean }>(contacts: T[]): T | null {
  return contacts.find((c) => c.isPrimary) ?? contacts[0] ?? null;
}
