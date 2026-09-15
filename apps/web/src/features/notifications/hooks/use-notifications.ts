'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  MarkAllReadResponse,
  NotificationItem,
  NotificationListResponse,
  UnreadCountResponse,
} from '@erp/types';

import {
  getNotifications,
  getUnreadCount,
  markAllRead,
  markRead,
  type GetNotificationsParams,
} from '../api/notifications-api';

export const notificationKeys = {
  all: ['notifications'] as const,
  /** The unread count the bell badge polls, kept separate from any list read. */
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
  /** A filtered list read; `unread` splits the bell's recent feed from the full page. */
  list: (params: GetNotificationsParams) =>
    [...notificationKeys.all, 'list', params] as const,
};

/**
 * The unread count that drives the bell badge.
 *
 * Polling is the transport (ADR-031 — there is no websocket): the count re-reads every 60s and on
 * window focus, so a notification generated while the tab sat idle surfaces without a manual reload.
 * The interval is deliberately on the cheap count endpoint, not the full list.
 */
export function useUnreadCount(): UseQueryResult<UnreadCountResponse, Error> {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: getUnreadCount,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * A page of notifications. The bell asks for the recent feed (`unread: false`, a small limit); the
 * full-page feed pages through the same read. `unreadTotal` on the response is what the badge shows,
 * so the bell can render its badge from this read alone once it is open.
 */
export function useNotifications(
  params: GetNotificationsParams = {},
): UseQueryResult<NotificationListResponse, Error> {
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () => getNotifications(params),
  });
}

/**
 * Marking a notification read moves two things the user can see: the row's own read state and the
 * bell's unread count. So the mutation invalidates every list read AND the unread-count key — the
 * badge and the feed refresh together, without either going stale against the other.
 */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation<NotificationItem, Error, string>({
    mutationFn: (id: string) => markRead(id),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: notificationKeys.all }),
        qc.invalidateQueries({ queryKey: notificationKeys.unreadCount() }),
      ]);
    },
  });
}

/** Clears the whole unread set. Same invalidation as a single read — badge and feed move as one. */
export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation<MarkAllReadResponse, Error, void>({
    mutationFn: () => markAllRead(),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: notificationKeys.all }),
        qc.invalidateQueries({ queryKey: notificationKeys.unreadCount() }),
      ]);
    },
  });
}
