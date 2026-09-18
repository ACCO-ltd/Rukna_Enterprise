/**
 * Collection lifecycle events — pure types and utility functions.
 *
 * Slice 6A: events are held in React context (ephemeral per session).
 * Slice 6B will replace the context with real API calls and persist events server-side.
 *
 * Design invariants enforced here:
 * - A promise never overwrites the contractual dueDate.
 * - A dispute never adjusts outstandingAmount.
 * - A follow-up is collection metadata only — it has no accounting effect.
 */

export type FollowUpMethod = 'WHATSAPP' | 'EMAIL' | 'PHONE' | 'PHYSICAL';
export type DisputeReason =
  | 'OMISSION'
  | 'PRICE_ERROR'
  | 'WORK_NOT_ACCEPTED'
  | 'SCOPE_DISAGREEMENT'
  | 'OTHER';

export interface FollowUpEvent {
  kind: 'FOLLOW_UP';
  id: string;
  invoiceId: string;
  method: FollowUpMethod;
  contactPerson: string | null;
  note: string | null;
  /** ISO datetime */
  recordedAt: string;
}

export interface PromiseEvent {
  kind: 'PROMISE';
  id: string;
  invoiceId: string;
  /** YYYY-MM-DD — the date the client committed to pay. Does NOT replace the invoice dueDate. */
  promisedDate: string;
  /** Optional committed amount — decimal string. */
  promisedAmount: string | null;
  note: string | null;
  /** ISO datetime */
  recordedAt: string;
}

export interface DisputeEvent {
  kind: 'DISPUTE';
  id: string;
  invoiceId: string;
  /** Optional disputed portion — decimal string. Does NOT reduce outstandingAmount. */
  disputedAmount: string | null;
  reason: DisputeReason;
  note: string | null;
  /** ISO datetime */
  openedAt: string;
  /** ISO datetime, or null if still open. */
  resolvedAt: string | null;
}

export type CollectionEvent = FollowUpEvent | PromiseEvent | DisputeEvent;

// ─── Queries ─────────────────────────────────────────────────────────────────

/** Returns the most recently recorded promise, or null. */
export function getLatestPromise(events: CollectionEvent[]): PromiseEvent | null {
  const promises = events
    .filter((e): e is PromiseEvent => e.kind === 'PROMISE')
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  return promises[0] ?? null;
}

/** Returns the open (unresolved) dispute, or null. */
export function getOpenDispute(events: CollectionEvent[]): DisputeEvent | null {
  return (
    events
      .filter((e): e is DisputeEvent => e.kind === 'DISPUTE' && e.resolvedAt === null)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0] ?? null
  );
}

/** Returns the most recent follow-up, or null. */
export function getLatestFollowUp(events: CollectionEvent[]): FollowUpEvent | null {
  const followUps = events
    .filter((e): e is FollowUpEvent => e.kind === 'FOLLOW_UP')
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  return followUps[0] ?? null;
}

/**
 * A promise is "missed" if its promised date has passed (promisedDate < today).
 * Whether the invoice has subsequently been paid is intentionally NOT checked here —
 * callers should filter to OVERDUE/PARTIALLY_PAID invoices before surfacing missed promises.
 */
export function isMissedPromise(promise: PromiseEvent, today: string): boolean {
  return promise.promisedDate < today;
}

export type AttentionReason = 'MISSED_PROMISE' | 'DISPUTED';

/**
 * Returns the attention reasons derived purely from collection events.
 * Callers layer these on top of the OVERDUE paymentState check.
 */
export function getAttentionReasons(events: CollectionEvent[], today: string): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  const latestPromise = getLatestPromise(events);
  if (latestPromise && isMissedPromise(latestPromise, today)) {
    reasons.push('MISSED_PROMISE');
  }
  if (getOpenDispute(events) !== null) {
    reasons.push('DISPUTED');
  }
  return reasons;
}

// ─── Timeline composition ─────────────────────────────────────────────────────

export type TimelineEventKind =
  | 'ISSUED'
  | 'SENT'
  | 'FOLLOW_UP'
  | 'PROMISE'
  | 'PROMISE_MISSED'
  | 'DISPUTE'
  | 'DISPUTE_RESOLVED'
  | 'PAYMENT';

export interface TimelineEntry {
  kind: TimelineEventKind;
  /** ISO datetime or date string used for sorting. */
  at: string;
  /** Human-readable detail (method name, amount, reason…). */
  detail: string | null;
  /** Secondary detail line. */
  detail2: string | null;
}

export interface TimelinePaymentEntry {
  date: string;
  amount: string | null;
  method: string | null;
}

/**
 * Compose all available data points for an invoice into a chronological timeline.
 * Entries are returned newest-first.
 */
export function buildInvoiceTimeline(opts: {
  issuedAt: string;
  sentAt: string | null;
  events: CollectionEvent[];
  payments: TimelinePaymentEntry[];
  today: string;
}): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  entries.push({ kind: 'ISSUED', at: opts.issuedAt, detail: null, detail2: null });

  if (opts.sentAt) {
    entries.push({ kind: 'SENT', at: opts.sentAt, detail: null, detail2: null });
  }

  for (const evt of opts.events) {
    if (evt.kind === 'FOLLOW_UP') {
      entries.push({
        kind: 'FOLLOW_UP',
        at: evt.recordedAt,
        detail: evt.method,
        detail2: evt.contactPerson,
      });
    } else if (evt.kind === 'PROMISE') {
      const missed = isMissedPromise(evt, opts.today);
      entries.push({
        kind: missed ? 'PROMISE_MISSED' : 'PROMISE',
        at: evt.recordedAt,
        detail: evt.promisedDate,
        detail2: evt.promisedAmount,
      });
    } else if (evt.kind === 'DISPUTE') {
      entries.push({
        kind: 'DISPUTE',
        at: evt.openedAt,
        detail: evt.reason,
        detail2: evt.disputedAmount,
      });
      if (evt.resolvedAt) {
        entries.push({ kind: 'DISPUTE_RESOLVED', at: evt.resolvedAt, detail: null, detail2: null });
      }
    }
  }

  for (const p of opts.payments) {
    entries.push({ kind: 'PAYMENT', at: p.date, detail: p.amount, detail2: p.method });
  }

  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
