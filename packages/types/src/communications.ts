/**
 * Outbound client communications (ADR-042 phase 2 — communication core).
 *
 * One record per business-initiated message Rukna sends a client (WhatsApp today; EMAIL reserved).
 * Status only moves forward: QUEUED → SENT → DELIVERED → READ, or FAILED / UNKNOWN (see ADR-042).
 */

export type MessageChannel = 'WHATSAPP' | 'EMAIL';

export type MessagePurpose =
  | 'INVOICE'
  | 'RECEIPT'
  | 'PAYMENT_REMINDER'
  | 'OVERDUE_REMINDER'
  // ADR-044 phase 2 — WhatsApp alerts to staff about competitive quotations (sent in the background).
  | 'QUOTE_READY'
  | 'QUOTE_REMINDER'
  | 'QUOTE_ESCALATION'
  | 'QUOTE_CHOSEN'
  | 'QUOTE_ANOTHER'
  // ADR-045 — paying from the award (no amounts in the text).
  | 'QUOTE_PAY_NEEDED'
  | 'QUOTE_CASH_RELEASED'
  | 'QUOTE_SUPPLIER_PAID';

export type StaffAlertPurpose = Extract<
  MessagePurpose,
  | 'QUOTE_READY'
  | 'QUOTE_REMINDER'
  | 'QUOTE_ESCALATION'
  | 'QUOTE_CHOSEN'
  | 'QUOTE_ANOTHER'
  | 'QUOTE_PAY_NEEDED'
  | 'QUOTE_CASH_RELEASED'
  | 'QUOTE_SUPPLIER_PAID'
>;

/**
 * ADR-044 phase 2 — one WhatsApp alert in a quotation request's delivery log (`messages` on the
 * request detail). No full phone number: only its last 3 digits. No message text, no amounts.
 */
export interface StaffAlertLogEntry {
  id: string;
  recipientName: string;
  /** `…678` — the last 3 digits of the number it went to. */
  recipientPhoneMasked: string;
  purpose: StaffAlertPurpose;
  /** QUEUED (incl. retrying) · SENT · DELIVERED · READ · FAILED · UNKNOWN (sent, never confirmed). */
  status: MessageStatus;
  /** ISO; when the alert was queued. */
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  /** Plain words, present when FAILED / UNKNOWN (or while a retry is pending). */
  failureReason: string | null;
}

/** UNKNOWN: the send went out but WhatsApp never confirmed it — may or may not have arrived; never auto-retried. */
export type MessageStatus = 'QUEUED' | 'UNKNOWN' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

/** Wire shape of `GET /communications?resourceType=&resourceId=` items (newest first). */
export interface OutboundMessageView {
  id: string;
  channel: MessageChannel;
  purpose: MessagePurpose;
  clientId: string | null;
  /** Full E.164 — the endpoint is gated on `manage:receivable`. */
  recipient: string;
  /** e.g. 'client_invoice' | 'payment_receipt'. */
  resourceType: string;
  resourceId: string;
  templateName: string | null;
  templateLanguage: string | null;
  status: MessageStatus;
  /** ISO timestamps. */
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  /** Typed send error (e.g. 'INVALID_RECIPIENT') or Meta's numeric code for a delivery failure. */
  errorCode: string | null;
  /** Plain words for staff. */
  errorMessage: string | null;
  createdBy: string;
  createdAt: string;
}

/** `POST /communications/:id/resolve` body — settle an UNKNOWN message after checking with the client. */
export interface ResolveMessageRequest {
  outcome: 'SENT' | 'FAILED';
  note?: string;
}
