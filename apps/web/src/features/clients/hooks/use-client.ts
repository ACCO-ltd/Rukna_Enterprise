'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { ClientStatus } from '@erp/types';

import {
  addClientContact,
  createClient,
  getClient,
  removeClientContact,
  updateClient,
  type AddContactPayload,
  type CreateClientPayload,
  type UpdateClientPayload,
} from '../api/clients-api';
import type { ClientDetail } from '../types';
import { clientKeys } from './use-clients';

export function useClient(id: string): UseQueryResult<ClientDetail, Error> {
  return useQuery({
    queryKey: clientKeys.detail(id),
    queryFn: () => getClient(id),
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateClientPayload) => createClient(payload),
    onSuccess: async (client) => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}

/** Form edits: save, then return to the client's page. */
export function useUpdateClient(id: string) {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateClientPayload) => updateClient(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
      router.push(`/clients/${id}`);
    },
  });
}

/**
 * Activate/deactivate from the detail page. Same endpoint as `useUpdateClient`, without
 * the navigation — the user is already on the page they want to stay on, and pushing the
 * route they are standing on would be a no-op that resets scroll position.
 */
export function useSetClientStatus(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (status: ClientStatus) => updateClient(id, { status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}

/**
 * Contact mutations invalidate the whole `clients` key rather than just the detail.
 *
 * A contact change alters the list too: the list column shows the primary contact, and
 * adding one with `isPrimary` demotes the previous primary server-side. Invalidating the
 * detail alone would leave the list showing a contact that is no longer primary.
 *
 * Removal answers 200 with an empty body (B6), so there is nothing to write back either
 * way — refetching is the only way to see the result.
 */
export function useAddContact(clientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: AddContactPayload) => addClientContact(clientId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}

export function useRemoveContact(clientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (contactId: string) => removeClientContact(clientId, contactId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}
