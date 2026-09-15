import type { NotificationKind, NotificationSeverity } from '@erp/types';

import type { NotificationEntity } from './notification.entity.js';

/**
 * ADR-031 — persistence port for notifications. The application layer and the generator depend on
 * this interface, never on Prisma directly (Clean Architecture). All operations are tenant-scoped: the
 * repository reads the tenant client from `TenancyService`, so an `organizationId` argument narrows
 * WITHIN the already-resolved tenant, it does not select the tenant.
 */
export interface INotificationRepository {
  /**
   * Idempotently create-or-refresh one row for a (recipient, condition). Re-arms a previously resolved
   * row by clearing `resolvedAt`, and refreshes the volatile fields (severity/context/actionUrl/kind).
   * Running the generator twice for the same live condition produces zero new rows.
   */
  upsertByDedupeKey(data: UpsertNotificationData): Promise<void>;

  /**
   * Resolve every un-resolved row of `resourceType` in the org whose `dedupeKey` is NOT in
   * `liveDedupeKeys` — the condition cleared (stage billed, invoice paid/cancelled) OR the resource
   * changed key (stage slipped DUE→OVERDUE, invoice aged into a new band), so the stale row is closed
   * with `resolvedAt = now()`. Keying on dedupeKey (not resourceId) is what prevents a still-live
   * resource from stacking a superseded row alongside its current one. An empty `liveDedupeKeys` closes
   * every open row of the type (the "condition fully cleared" case).
   */
  autoResolveMissing(
    organizationId: string,
    resourceType: string,
    liveDedupeKeys: string[],
  ): Promise<number>;

  /** Recipient's feed, newest first, excluding resolved rows; `unread` narrows to `readAt IS NULL`. */
  findForRecipientPaged(
    organizationId: string,
    recipientUserId: string,
    query: FindForRecipientQuery,
  ): Promise<PagedNotifications>;

  /** Recipient's total unread, un-resolved count — regardless of any page/filter. Drives the bell badge. */
  countUnread(organizationId: string, recipientUserId: string): Promise<number>;

  /**
   * Mark one of the caller's own rows read. Returns the updated row, or `null` if the id is not the
   * caller's own un-resolved notification (the service maps `null` to a 404 — no existence leak).
   */
  markRead(
    organizationId: string,
    recipientUserId: string,
    notificationId: string,
  ): Promise<NotificationEntity | null>;

  /** Mark all of the caller's unread, un-resolved rows read. Returns the number updated. */
  markAllRead(organizationId: string, recipientUserId: string): Promise<number>;
}

export interface UpsertNotificationData {
  organizationId: string;
  recipientUserId: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  dedupeKey: string;
  projectId: string | null;
  contractId: string | null;
  resourceType: string;
  resourceId: string;
  contextData: Record<string, string | number> | null;
  actionUrl: string | null;
}

export interface FindForRecipientQuery {
  unread: boolean;
  page: number;
  limit: number;
}

export interface PagedNotifications {
  items: NotificationEntity[];
  /** Total rows matching the applied filter (unread when `unread=true`), for the recipient. */
  total: number;
}
