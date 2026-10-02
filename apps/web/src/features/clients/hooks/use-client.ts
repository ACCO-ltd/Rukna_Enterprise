'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import {
  addClientContact,
  createClient,
  deactivateClient,
  getClient,
  getClientActivity,
  getClientOverview,
  makeClientContactPrimary,
  reactivateClient,
  removeClientContact,
  updateClient,
  updateClientContact,
} from '../api/clients-api';
import type {
  AddContactPayload,
  Client,
  ClientActivityEntry,
  ClientContact,
  ClientDetail,
  ClientOverview,
  CreateClientPayload,
  UpdateClientPayload,
  UpdateContactPayload,
} from '../types';
import { clientKeys } from './use-clients';

export function useClient(id: string): UseQueryResult<ClientDetail, Error> {
  return useQuery({
    queryKey: clientKeys.detail(id),
    queryFn: () => getClient(id),
  });
}

export function useClientOverview(id: string): UseQueryResult<ClientOverview, Error> {
  return useQuery({
    queryKey: clientKeys.overview(id),
    queryFn: () => getClientOverview(id),
  });
}

export function useClientActivity(
  id: string,
  limit = 10,
): UseQueryResult<ClientActivityEntry[], Error> {
  return useQuery({
    queryKey: [...clientKeys.activity(id), limit],
    queryFn: () => getClientActivity(id, limit),
  });
}

/**
 * Every client write invalidates the whole `clients` key: the list shows the primary contact,
 * the record's activity feed gains an entry, and `allowedCommands` can change with any of them.
 */
function useInvalidateClients() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: clientKeys.all });
}

export function useCreateClient() {
  const invalidate = useInvalidateClients();

  // No feedback `meta`: the form's own success toast carries a "Create project" action, and the
  // inline create (inside the project form) selects the new client instead.
  return useMutation({
    mutationFn: (payload: CreateClientPayload) => createClient(payload),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/** Form edits: save, then return to the client's page. */
export function useUpdateClient(id: string) {
  const router = useRouter();
  const invalidate = useInvalidateClients();

  return useMutation({
    mutationFn: (payload: UpdateClientPayload) => updateClient(id, payload),
    onSuccess: async () => {
      await invalidate();
      router.push(`/clients/${id}`);
    },
    meta: {
      successToast: {
        key: 'platform.feedback.clientUpdated',
        values: (data) => ({ name: (data as Client).name }),
      },
    },
  });
}

export function useDeactivateClient(id: string) {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (reason: string) => deactivateClient(id, reason),
    onSuccess: async () => {
      await invalidate();
    },
    meta: { successToast: 'platform.feedback.clientDeactivated', flashRow: false },
  });
}

export function useReactivateClient(id: string) {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: () => reactivateClient(id),
    onSuccess: async () => {
      await invalidate();
    },
    meta: { successToast: 'platform.feedback.clientReactivated', flashRow: false },
  });
}

export function useAddContact(clientId: string) {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (payload: AddContactPayload) => addClientContact(clientId, payload),
    onSuccess: async () => {
      await invalidate();
    },
    meta: {
      successToast: {
        key: 'platform.feedback.contactAdded',
        values: (data) => ({ name: (data as ClientContact | undefined)?.name ?? '' }),
      },
      flashRow: false,
    },
  });
}

export function useUpdateContact(clientId: string) {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ contactId, payload }: { contactId: string; payload: UpdateContactPayload }) =>
      updateClientContact(clientId, contactId, payload),
    onSuccess: async () => {
      await invalidate();
    },
    meta: { successToast: 'platform.feedback.contactUpdated', flashRow: false },
  });
}

export function useMakeContactPrimary(clientId: string) {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (contactId: string) => makeClientContactPrimary(clientId, contactId),
    onSuccess: async () => {
      await invalidate();
    },
    meta: { successToast: 'platform.feedback.contactMadePrimary', flashRow: false },
  });
}

/** Removal answers with an empty body, so refetching is the only way to see the result. */
export function useRemoveContact(clientId: string) {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (contactId: string) => removeClientContact(clientId, contactId),
    onSuccess: async () => {
      await invalidate();
    },
    meta: { successToast: 'platform.feedback.contactRemoved', flashRow: false },
  });
}
