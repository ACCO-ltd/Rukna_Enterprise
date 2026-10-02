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

// ─── Send by WhatsApp (ADR-042, WhatsApp V1 step 2: invoices) ──────────────────────────────────

// NOTE: the parallel receipt branch (feat/receipt-pdf-whatsapp) defines these same four types, with
// identical shapes, in `whatsapp-send.ts`. When both land, keep that file and delete this block.

/** Why a WhatsApp send cannot go ahead, in the order they are checked (null when it can). */
export type WhatsAppSendBlockedReason =
  | 'NOT_POSTED'
  /** No saved contact number. Soft: the user can still type another number. */
  | 'NO_RECIPIENT'
  | 'TEMPLATE_NOT_CONFIGURED'
  | 'WHATSAPP_NOT_CONFIGURED';

/** A client contact number the message can go to. */
export interface WhatsAppRecipientOption {
  contactId: string;
  name: string;
  role: string | null;
  /** E.164. */
  number: string;
  isPrimary: boolean;
  /** Which contact field the number came from. */
  source: 'whatsapp' | 'phone';
}

/** `GET /invoices/:id/whatsapp/preview` — what a WhatsApp send of this record would send. */
export interface WhatsAppSendPreview {
  templateConfigured: boolean;
  whatsappConfigured: boolean;
  recipients: WhatsAppRecipientOption[];
  /** The primary contact's WhatsApp number ?? phone (E.164), else the first saved number, else null. */
  defaultRecipient: string | null;
  /** The message body with its variables filled, as the client will read it. */
  message: string;
  /** The attached PDF's file name, e.g. INV-000042.pdf. */
  filename: string;
  /** True when a send with the default recipient can go ahead. */
  sendable: boolean;
  blockedReason: WhatsAppSendBlockedReason | null;
}

/** `POST /invoices/:id/whatsapp` body. Answers an `OutboundMessageView` (200, also for FAILED/UNKNOWN). */
export interface WhatsAppSendRequest {
  /** E.164; omitted → the preview's defaultRecipient. */
  recipient?: string;
  /** Client-generated (uuid), one per intended message: a repeat returns the same message. */
  idempotencyKey: string;
}

/** `POST /communications/:id/resolve` body — settle an UNKNOWN message after checking with the client. */
export interface ResolveMessageRequest {
  outcome: 'SENT' | 'FAILED';
  note?: string;
}
