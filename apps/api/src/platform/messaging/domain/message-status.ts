import type { MessageStatus } from '@prisma/client';

/**
 * ADR-042 phase 2 — status rules for an OutboundMessage.
 *
 *   QUEUED → SENT → DELIVERED → READ   (forward only; Meta's webhooks can arrive out of order, so a
 *                                       late "sent" after "delivered" is ignored)
 *   UNKNOWN  the send request went out but Meta never answered. Same rank as QUEUED: a webhook may
 *            still move it forward, but it is never retried automatically (it may have been sent).
 *   FAILED   a definite refusal. Overrides QUEUED / UNKNOWN / SENT / DELIVERED, never READ (a read
 *            message was received — a later failure report cannot undo that). Terminal for webhooks;
 *            re-armed only by a deliberate retry through CommunicationService (same idempotency key).
 *   A repeat of the current status is a no-op.
 */
type Progress = Exclude<MessageStatus, 'FAILED'>;
const RANK: Record<Progress, number> = { QUEUED: 0, UNKNOWN: 0, SENT: 1, DELIVERED: 2, READ: 3 };

/** The statuses from which `incoming` may be applied (the conditional-update guard). */
export function statusesThatAccept(incoming: MessageStatus): MessageStatus[] {
  if (incoming === 'FAILED') return ['QUEUED', 'UNKNOWN', 'SENT', 'DELIVERED'];
  const target = RANK[incoming];
  if (target === 0) return [];
  return (Object.keys(RANK) as Progress[]).filter((s) => RANK[s] < target);
}

export function canTransition(current: MessageStatus, incoming: MessageStatus): boolean {
  return statusesThatAccept(incoming).includes(current);
}

/** Meta's webhook status word → our status, or null for anything we don't track ('deleted', …). */
export function fromMetaStatus(status: string): MessageStatus | null {
  switch (status) {
    case 'sent':
      return 'SENT';
    case 'delivered':
      return 'DELIVERED';
    case 'read':
      return 'READ';
    case 'failed':
      return 'FAILED';
    default:
      return null;
  }
}

/** The timestamp column a webhook status sets. */
export const STATUS_TIMESTAMP = {
  SENT: 'sentAt',
  DELIVERED: 'deliveredAt',
  READ: 'readAt',
  FAILED: 'failedAt',
} as const;

export type WebhookStatus = keyof typeof STATUS_TIMESTAMP;

/**
 * Earlier timestamps implied by a jump ahead (READ before DELIVERED arrived): filled only where
 * still null, with the same instant.
 */
export const IMPLIED_TIMESTAMPS: Record<WebhookStatus, Array<'sentAt' | 'deliveredAt'>> = {
  SENT: [],
  DELIVERED: ['sentAt'],
  READ: ['sentAt', 'deliveredAt'],
  FAILED: [],
};

/** Rows that need a human look when they sit too long (no provider confirmation). */
export const STALE_STATUSES: MessageStatus[] = ['QUEUED', 'UNKNOWN'];

/** E.164 with the leading '+'. */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
