import type { MessageStatus, OutboundMessageView } from '@erp/types';
import type { BadgeTone } from '@erp/ui';

/** Pill tone per message status (ADR-042). */
export const MESSAGE_STATUS_TONE: Record<MessageStatus, BadgeTone> = {
  QUEUED: 'progress',
  SENT: 'info',
  DELIVERED: 'success',
  READ: 'success',
  FAILED: 'danger',
  UNKNOWN: 'attention',
};

/** Statuses that WhatsApp may still move forward (a tick may arrive). */
const MOVING: ReadonlySet<MessageStatus> = new Set(['QUEUED', 'SENT', 'DELIVERED']);

/** How long after its last change a message is still worth polling for ticks. */
export const POLL_WINDOW_MS = 5 * 60_000;
export const POLL_INTERVAL_MS = 10_000;

/** When the message last changed — the latest of its status timestamps. */
export function lastActivityAt(message: OutboundMessageView): number {
  const stamps = [
    message.queuedAt,
    message.sentAt,
    message.deliveredAt,
    message.readAt,
    message.failedAt,
  ]
    .filter((v): v is string => Boolean(v))
    .map((v) => Date.parse(v))
    .filter((v) => Number.isFinite(v));
  return stamps.length ? Math.max(...stamps) : 0;
}

/**
 * Poll while any message could still get a tick and changed recently — a few minutes, then stop
 * (a message nobody opens stays at Delivered forever; it would never be worth polling).
 */
export function shouldPollMessages(
  messages: OutboundMessageView[] | undefined,
  now: number,
): boolean {
  if (!messages) return false;
  return messages.some((m) => MOVING.has(m.status) && now - lastActivityAt(m) < POLL_WINDOW_MS);
}

/** The time to show for the message's current status. */
export function statusTime(message: OutboundMessageView): string {
  switch (message.status) {
    case 'READ':
      return message.readAt ?? message.queuedAt;
    case 'DELIVERED':
      return message.deliveredAt ?? message.queuedAt;
    case 'SENT':
      return message.sentAt ?? message.queuedAt;
    case 'FAILED':
      return message.failedAt ?? message.queuedAt;
    default:
      return message.queuedAt;
  }
}

/** WhatsApp accepted the message. */
export function isReached(status: MessageStatus): boolean {
  return status === 'SENT' || status === 'DELIVERED' || status === 'READ';
}
