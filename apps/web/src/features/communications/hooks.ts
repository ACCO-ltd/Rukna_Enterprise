'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { OutboundMessageView, ResolveMessageRequest } from '@erp/types';

import { listCommunications, resolveCommunication, type CommunicationResourceType } from './api';
import { POLL_INTERVAL_MS, shouldPollMessages } from './message-status';

export const communicationKeys = {
  all: ['communications'] as const,
  resource: (resourceType: CommunicationResourceType, resourceId: string) =>
    ['communications', resourceType, resourceId] as const,
};

/**
 * Messages sent about one record. Polls every ~10 s while a recent message can still get a tick
 * (Sending → Sent → Delivered → Read), and stops on its own a few minutes later.
 */
export function useCommunications(
  resourceType: CommunicationResourceType,
  resourceId: string,
  enabled = true,
): UseQueryResult<OutboundMessageView[], Error> {
  return useQuery({
    queryKey: communicationKeys.resource(resourceType, resourceId),
    queryFn: () => listCommunications(resourceType, resourceId),
    enabled: enabled && Boolean(resourceId),
    refetchInterval: (query) =>
      shouldPollMessages(query.state.data, Date.now()) ? POLL_INTERVAL_MS : false,
  });
}

/**
 * Settle an UNKNOWN message. Refreshes the record's messages and whatever else listens under
 * `invalidate` (e.g. the invoice, which becomes Sent once a delivery is recorded).
 */
export function useResolveCommunication(invalidate: ReadonlyArray<readonly unknown[]> = []) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ResolveMessageRequest }) =>
      resolveCommunication(id, body),
    meta: { flashRow: false },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: communicationKeys.all }),
        ...invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ]);
    },
  });
}
