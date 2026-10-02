import type { MessageStatus } from '@prisma/client';

/**
 * ADR-042 phase 2 — status rules for an OutboundMessage.
 *
 *   QUEUED → SENT → DELIVERED → READ   (forward only; Meta's webhooks can arrive out of order, so a
 *                                       late "sent" after "delivered" is ignored)
 *   FAILED overrides QUEUED / SENT / DELIVERED, never READ (a read message was received — a later
 *          failure report cannot undo that).
 *   FAILED is terminal for webhook updates. A FAILED row is re-armed only by a deliberate retry
 *          through CommunicationService (same idempotency key), never by a webhook.
 *   A repeat of the current status is a no-op.
 */
const RANK: Record<Exclude<MessageStatus, 'FAILED'>, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };

/** The statuses from which `incoming` may be applied (the conditional-update guard). */
export function statusesThatAccept(incoming: MessageStatus): MessageStatus[] {
  if (incoming === 'FAILED') return ['QUEUED', 'SENT', 'DELIVERED'];
  if (incoming === 'QUEUED') return [];
  const target = RANK[incoming];
  return (Object.keys(RANK) as Array<keyof typeof RANK>).filter((s) => RANK[s] < target);
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

/** The timestamp column a status sets. */
export const STATUS_TIMESTAMP = {
  SENT: 'sentAt',
  DELIVERED: 'deliveredAt',
  READ: 'readAt',
  FAILED: 'failedAt',
} as const satisfies Record<Exclude<MessageStatus, 'QUEUED'>, string>;

/** E.164 with the leading '+'. */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
