import type {
  MarkAllReadResponse,
  NotificationItem,
  NotificationListResponse,
  UnreadCountResponse,
} from '@erp/types';

import { apiClient } from '@/lib/api-client';

/**
 * In-app notification center API client (ADR-031).
 *
 * Every shape comes from `@erp/types`. The server owns the whole notification: what it says (via
 * `contextData` the client interpolates into a localized string), where it points (`actionUrl`),
 * and whether it is read (`readAt`). The client never decides a notification's severity or text —
 * it renders the server's record. Polling is the deliberate transport; there is no websocket.
 */

export interface GetNotificationsParams {
  /** When true, only unread items; when false/omitted, the full feed. */
  unread?: boolean;
  page?: number;
  limit?: number;
}

/** The caller's notifications, newest first. `unreadTotal` drives the bell badge regardless of filter. */
export function getNotifications(
  params: GetNotificationsParams = {},
): Promise<NotificationListResponse> {
  const query: Record<string, string> = {};
  if (params.unread !== undefined) query.unread = params.unread ? 'true' : 'false';
  if (params.page !== undefined) query.page = String(params.page);
  if (params.limit !== undefined) query.limit = String(params.limit);
  return apiClient<NotificationListResponse>('/notifications', { params: query });
}

/** The unread count on its own — a cheap read the bell polls on an interval. */
export function getUnreadCount(): Promise<UnreadCountResponse> {
  return apiClient<UnreadCountResponse>('/notifications/unread-count');
}

/** Marks a single notification read; returns the updated record (`readAt` now set). */
export function markRead(id: string): Promise<NotificationItem> {
  return apiClient<NotificationItem>(`/notifications/${id}/read`, { method: 'PATCH' });
}

/** Marks every unread notification read for the caller; returns how many rows changed. */
export function markAllRead(): Promise<MarkAllReadResponse> {
  return apiClient<MarkAllReadResponse>('/notifications/read-all', { method: 'POST' });
}
