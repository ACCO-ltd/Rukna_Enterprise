import type { ClientStatus } from '@erp/types';

import { apiClient } from '@/lib/api-client';

import type {
  AddContactPayload,
  Client,
  ClientActivityEntry,
  ClientContact,
  ClientDetail,
  ClientOverview,
  ClientSummaryPage,
  ClientSummaryQuery,
  ClientType,
  CreateClientPayload,
  UpdateClientPayload,
  UpdateContactPayload,
} from '../types';

export type {
  AddContactPayload,
  CreateClientPayload,
  UpdateClientPayload,
  UpdateContactPayload,
} from '../types';

export interface ClientDuplicateCandidate {
  id: string;
  name: string;
  type: ClientType;
  status: ClientStatus;
}

/** `GET /clients` — every client, ordered by name. Pickers elsewhere (projects, invoices) read this. */
export function listClients(): Promise<Client[]> {
  return apiClient<Client[]>('/clients');
}

/**
 * `GET /clients/summary` — the Clients list. Search, filters, sort and paging all run on the
 * server (clients-redesign contract); an unset value is omitted rather than sent empty.
 */
export function listClientSummaries(query: ClientSummaryQuery = {}): Promise<ClientSummaryPage> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params[key] = String(value);
  }
  return apiClient<ClientSummaryPage>('/clients/summary', { params });
}

export function findClientDuplicateCandidates(name: string): Promise<ClientDuplicateCandidate[]> {
  return apiClient<ClientDuplicateCandidate[]>(
    `/clients/duplicate-candidates?name=${encodeURIComponent(name)}`,
  );
}

/** The client with its contacts, `allowedCommands` and `deactivationBlockedBy`. */
export function getClient(id: string): Promise<ClientDetail> {
  return apiClient<ClientDetail>(`/clients/${id}`);
}

export function getClientOverview(id: string): Promise<ClientOverview> {
  return apiClient<ClientOverview>(`/clients/${id}/overview`);
}

export function getClientActivity(id: string, limit = 10): Promise<ClientActivityEntry[]> {
  return apiClient<ClientActivityEntry[]>(`/clients/${id}/activity`, {
    params: { limit: String(limit) },
  });
}

export function createClient(payload: CreateClientPayload): Promise<Client> {
  return apiClient<Client>('/clients', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateClient(id: string, payload: UpdateClientPayload): Promise<Client> {
  return apiClient<Client>(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

/** `reason` 3–500 characters. 409 `CLIENT_HAS_ACTIVE_PROJECTS` / `CLIENT_HAS_OPEN_BALANCE`. */
export function deactivateClient(id: string, reason: string): Promise<Client> {
  return apiClient<Client>(`/clients/${id}/deactivate`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function reactivateClient(id: string): Promise<Client> {
  return apiClient<Client>(`/clients/${id}/reactivate`, { method: 'POST' });
}

/**
 * Adds a contact. The client's first contact is always primary; `isPrimary: true` demotes the
 * current primary in the same transaction.
 */
export function addClientContact(clientId: string, payload: AddContactPayload): Promise<ClientContact> {
  return apiClient<ClientContact>(`/clients/${clientId}/contacts`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateClientContact(
  clientId: string,
  contactId: string,
  payload: UpdateContactPayload,
): Promise<ClientContact> {
  return apiClient<ClientContact>(`/clients/${clientId}/contacts/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function makeClientContactPrimary(clientId: string, contactId: string): Promise<ClientContact> {
  return apiClient<ClientContact>(`/clients/${clientId}/contacts/${contactId}/make-primary`, {
    method: 'POST',
  });
}

/** 409 `CONTACT_IS_PRIMARY` for the primary — another contact must be made primary first. */
export function removeClientContact(clientId: string, contactId: string): Promise<void> {
  return apiClient<void>(`/clients/${clientId}/contacts/${contactId}`, { method: 'DELETE' });
}
