/**
 * In-app notification center (ADR-031).
 *
 * Wire shapes shared between the API and the web client. A notification is a persistent,
 * per-recipient record produced by the daily generator; `contextData` carries only the values the
 * client interpolates into a localized string (title/impact) — the API never ships user-facing
 * prose. `resolvedAt` is intentionally NOT exposed: resolved rows never leave the server.
 */

export type NotificationKind =
  | 'STAGE_PAYMENT_DUE'
  | 'STAGE_PAYMENT_OVERDUE'
  | 'CLIENT_INVOICE_OVERDUE'
  // ADR-044 §10 — event-driven quotation notifications (written in the command's transaction).
  | 'QUOTES_READY'
  | 'QUOTATION_AWARDED'
  | 'ANOTHER_QUOTE_REQUESTED';

/**
 * ADR-044 §10 — `contextData` of the three quotation kinds. Interpolation values only, and never an
 * amount: a notification is readable by people who may not see money.
 */
export interface QuotationNotificationContext {
  /** The quotation request number (QR-00001). */
  number: string;
  /** The material request number (MR-00001). */
  mrNumber: string;
  projectName?: string;
  /** ACTIVE quotes on the request when the event happened. */
  quoteCount: number;
  /** Finance's note on ANOTHER_QUOTE_REQUESTED. */
  note?: string;
}

export type NotificationSeverity = 'INFO' | 'WARNING' | 'URGENT';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  /** Deep-link context; may be null for org-level items. */
  projectId: string | null;
  contractId: string | null;
  resourceType: string;
  resourceId: string;
  /** Interpolation values for the localized title/impact (e.g. `{ stageName, dueInDays, amount }`). */
  contextData: Record<string, string | number> | null;
  /** Where the notification points; the client navigates here on click. */
  actionUrl: string | null;
  /** ISO timestamp when the caller read it, or null while unread. */
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  page: number;
  limit: number;
  /** Total notifications for the caller (matching the `unread` filter when applied). */
  total: number;
  /** Total unread for the caller, regardless of the current page/filter — drives the bell badge. */
  unreadTotal: number;
}

export interface UnreadCountResponse {
  count: number;
}

export interface MarkAllReadResponse {
  updated: number;
}
