/**
 * Outbound client communications (ADR-042 phase 2 — communication core).
 *
 * One record per business-initiated message Rukna sends a client (WhatsApp today; EMAIL reserved).
 * Status only moves forward: QUEUED → SENT → DELIVERED → READ, or FAILED / UNKNOWN (see ADR-042).
 */

export type MessageChannel = 'WHATSAPP' | 'EMAIL';

export type MessagePurpose = 'INVOICE' | 'RECEIPT' | 'PAYMENT_REMINDER' | 'OVERDUE_REMINDER';

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
