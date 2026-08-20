import type { ClientStatus } from '@erp/types';

import { apiClient } from '@/lib/api-client';

import type { Client, ClientContact, ClientDetail, ClientListItem } from '../types';

/**
 * Body accepted by `POST /clients`, mirroring CreateClientDto.
 *
 * `status` is deliberately absent. `api-reference.md:283-293` shows it in the example
 * body, but `CreateClientDto` does not declare it and the API validates with
 * `forbidNonWhitelisted: true` — sending it is a 400, not a silently ignored field. See
 * D3 in docs/backend-requests/frontend-blockers.md. Every client starts ACTIVE by schema
 * default; deactivating is a PATCH.
 */
export interface CreateClientPayload {
  name: string;
  type?: 'COMPANY' | 'GOVERNMENT' | 'NGO' | 'INDIVIDUAL' | 'OTHER';
  taxNumber?: string;
  defaultCurrency?: string;
  address?: string;
  notes?: string;
  primaryContact?: { name: string; role?: string; phone?: string; email?: string };
}

export interface ClientDuplicateCandidate {
  id: string;
  name: string;
  type: 'COMPANY' | 'GOVERNMENT' | 'NGO' | 'INDIVIDUAL' | 'OTHER';
  status: ClientStatus;
}

/**
 * Body accepted by `PATCH /clients/:id`.
 *
 * `code` is absent because `UpdateClientDto` does not declare it — a client's code is
 * immutable once created, and it is the identifier other records will reference.
 *
 * `null` clears a field; omission leaves it unchanged. See `toUpdateClientPayload`.
 * `status` is nullable in this type only for symmetry — never send null for it, the
 * column is NOT NULL.
 */
export interface UpdateClientPayload {
  name?: string;
  type?: 'COMPANY' | 'GOVERNMENT' | 'NGO' | 'INDIVIDUAL' | 'OTHER';
  taxNumber?: string | null;
  defaultCurrency?: string | null;
  address?: string | null;
  notes?: string | null;
  status?: ClientStatus;
}

export interface AddContactPayload {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
}

/**
 * `GET /clients` takes NO parameters.
 *
 * Both `api-reference.md:276` and `apps/web/CLAUDE.md` documented a `?status=ACTIVE`
 * filter, but `ClientsController.findAll` accepts no query and the repository applies no
 * status predicate — the parameter is silently ignored (D3). Filtering happens in
 * `filter-clients.ts` against the cached array.
 *
 * Results arrive ordered by name.
 */
export function listClients(): Promise<Client[]> {
  return apiClient<Client[]>('/clients');
}

export function listClientSummaries(): Promise<ClientListItem[]> {
  return apiClient<ClientListItem[]>('/clients/summary');
}

export function findClientDuplicateCandidates(name: string): Promise<ClientDuplicateCandidate[]> {
  return apiClient<ClientDuplicateCandidate[]>(`/clients/duplicate-candidates?name=${encodeURIComponent(name)}`);
}

/** Returns the client with its contacts. */
export function getClient(id: string): Promise<ClientDetail> {
  return apiClient<ClientDetail>(`/clients/${id}`);
}

export function createClient(payload: CreateClientPayload): Promise<Client> {
  return apiClient<Client>('/clients', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateClient(id: string, payload: UpdateClientPayload): Promise<Client> {
  return apiClient<Client>(`/clients/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * Adds a contact.
 *
 * Sending `isPrimary: true` demotes every other contact on this client to non-primary in
 * the same request (`client-prisma.repository.ts:53-58`). That is a side effect on records
 * the user did not name, so the form says so before they submit.
 */
export function addClientContact(
  clientId: string,
  payload: AddContactPayload,
): Promise<ClientContact> {
  return apiClient<ClientContact>(`/clients/${clientId}/contacts`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Removes a contact. Answers 200 with an EMPTY body — the service returns void, so there
 * is nothing to read back and callers must refetch (B6 family).
 *
 * Note the API deletes by `contactId` alone without checking it belongs to `clientId`
 * (`client-prisma.repository.ts:63`). The path segment is validated, the contact is not.
 * We always pass a contact read from this client, so our calls are correct — recorded
 * because it is the same scoping gap as C2, raised as C11.
 */
export function removeClientContact(clientId: string, contactId: string): Promise<void> {
  return apiClient<void>(`/clients/${clientId}/contacts/${contactId}`, { method: 'DELETE' });
}
