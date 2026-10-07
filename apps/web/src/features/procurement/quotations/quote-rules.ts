/**
 * Pure presentation rules for quotations. No React, no I/O — every branch is unit-tested.
 *
 * Nothing here *decides* policy the server owns (segregation of duties, the count rule, award
 * preconditions). It reads the server's verdicts (`allowedActions`, `requiredQuoteCount`,
 * `isLowest`) and only computes what the screen needs before the server has answered: the live
 * lowest while finance types, the send button's "why not yet", a waiting time in words.
 */

import { MONEY_SCALE, parseMinorUnits } from '@/lib/money';

import type {
  PersonRef,
  Quote,
  QuotationActionName,
  QuotationAllowedAction,
  QuotationRequestDetail,
  QuotationRequestStatus,
} from './types';

// ─── allowedActions ──────────────────────────────────────────────────────────────

/**
 * The server's verdict for one action, or `null` when it sent none (the screen then falls back to
 * status + permission, and the server still refuses whatever is not allowed).
 */
export function findAction(
  actions: QuotationAllowedAction[] | null | undefined,
  name: QuotationActionName,
): QuotationAllowedAction | null {
  return actions?.find((entry) => entry.action === name) ?? null;
}

/** Enabled unless the server said no. */
export function actionEnabled(
  actions: QuotationAllowedAction[] | null | undefined,
  name: QuotationActionName,
  fallback: boolean,
): boolean {
  const verdict = findAction(actions, name);
  return verdict ? verdict.enabled : fallback;
}

/** Segregation-of-duties codes the server uses to bar a selector (ADR-044 §6). */
export const SOD_CODES = new Set(['QUOTE_UPLOADER_CANNOT_SELECT', 'REQUESTER_CANNOT_SELECT']);

/**
 * The SoD rule barring this viewer from selecting, read from the server's `allowedActions`
 * (never computed here), or null.
 */
export function selectionBarCode(detail: Pick<QuotationRequestDetail, 'allowedActions'>): string | null {
  for (const name of ['AWARD', 'ENTER_TOTAL'] as const) {
    const verdict = findAction(detail.allowedActions, name);
    if (verdict && !verdict.enabled && verdict.reasonCode && SOD_CODES.has(verdict.reasonCode)) {
      return verdict.reasonCode;
    }
  }
  return null;
}

// ─── Stores and counts ───────────────────────────────────────────────────────────

/** The distinct-store identity, mirroring the server's `storeKey` normalisation (§4.5). */
export function storeKey(choice: { supplierId?: string | null; storeName?: string | null; name?: string }): string {
  if (choice.supplierId) return `supplier:${choice.supplierId}`;
  const name = (choice.storeName ?? choice.name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return `name:${name}`;
}

export function activeQuotes(quotes: Quote[] | null | undefined): Quote[] {
  return (quotes ?? []).filter((quote) => quote.status === 'ACTIVE');
}

/**
 * How many stores the buyer should aim for. The server's `requiredQuoteCount` is authoritative;
 * when the estimate is visible and unknown the screen still asks for 3 (ADR-044 §4.5: "on send
 * with an unknown estimate the UI asks for 3").
 */
export function collectTarget(
  detail: Pick<QuotationRequestDetail, 'requiredQuoteCount' | 'estimateAmount' | 'moneyVisible'>,
): number {
  const unknownEstimate = detail.moneyVisible && detail.estimateAmount === null;
  return Math.max(detail.requiredQuoteCount || 1, unknownEstimate ? 3 : 0);
}

export type SendBlock =
  | { kind: 'empty' }
  | { kind: 'uploading'; count: number }
  | { kind: 'needsStore'; count: number }
  | { kind: 'failed'; count: number }
  | { kind: 'reason' };

/** Pending-queue phases as the send rule sees them. */
export interface PendingUploadLike {
  phase: 'queued' | 'uploading' | 'binding' | 'needsStore' | 'retrying' | 'offline' | 'failed';
}

/**
 * Why "Send to finance" is not available yet, in priority order, or null when it is. A short
 * request (fewer distinct stores than the target) needs an exception reason chip.
 */
export function sendBlock(input: {
  pending: PendingUploadLike[];
  savedDistinct: number;
  savedCount: number;
  target: number;
  exceptionReason: string | null;
}): SendBlock | null {
  const failed = input.pending.filter((p) => p.phase === 'failed').length;
  const needsStore = input.pending.filter((p) => p.phase === 'needsStore').length;
  const moving = input.pending.length - failed - needsStore;
  if (failed > 0) return { kind: 'failed', count: failed };
  if (needsStore > 0) return { kind: 'needsStore', count: needsStore };
  if (moving > 0) return { kind: 'uploading', count: moving };
  if (input.savedCount === 0) return { kind: 'empty' };
  if (input.savedDistinct < input.target && !input.exceptionReason) return { kind: 'reason' };
  return null;
}

// ─── Totals and the lowest quote ─────────────────────────────────────────────────

/** A typed total as minor units, or null when empty / not a positive amount. */
export function totalMinor(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const minor = parseMinorUnits(raw, MONEY_SCALE);
  if (minor === null || minor <= 0) return null;
  return minor;
}

/** Every quote id at the minimum total (ties: all of them). Empty until at least one total. */
export function lowestQuoteIds(totals: Array<{ id: string; total: string | null | undefined }>): Set<string> {
  let min: number | null = null;
  for (const entry of totals) {
    const minor = totalMinor(entry.total);
    if (minor !== null && (min === null || minor < min)) min = minor;
  }
  const ids = new Set<string>();
  if (min === null) return ids;
  for (const entry of totals) if (totalMinor(entry.total) === min) ids.add(entry.id);
  return ids;
}

/** True when every quote has a positive total — the precondition for Choose. */
export function allTotalsEntered(totals: Array<{ total: string | null | undefined }>): boolean {
  return totals.length > 0 && totals.every((entry) => totalMinor(entry.total) !== null);
}

// ─── Waiting time ────────────────────────────────────────────────────────────────

export function durationParts(minutes: number | null | undefined): { hours: number; minutes: number } {
  const total = Math.max(0, Math.floor(minutes ?? 0));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** Statuses where the request sits with finance and the waiting clock runs. */
export const WAITING_STATUSES: ReadonlySet<QuotationRequestStatus> = new Set([
  'AWAITING_DECISION',
  'AWARD_PENDING_APPROVAL',
]);

/** Statuses where the buyer can add or remove quotes. */
export const COLLECTING_STATUSES: ReadonlySet<QuotationRequestStatus> = new Set(['COLLECTING', 'RETURNED']);

/** Rows sorted longest-waiting first (the server orders the decide queue too; this keeps it so). */
export function byWaitingDesc<T extends { waitingWorkingMinutes: number | null; sentAt: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const wa = a.waitingWorkingMinutes ?? -1;
    const wb = b.waitingWorkingMinutes ?? -1;
    if (wa !== wb) return wb - wa;
    return (a.sentAt ?? '').localeCompare(b.sentAt ?? '');
  });
}

/** A line's unit as text: the server sends `{ code, name }`; older shapes send a string. */
export function uomLabel(uom: QuotationLineUom): string {
  if (!uom) return '';
  if (typeof uom === 'string') return uom;
  return uom.symbol ?? uom.code ?? uom.name ?? '';
}

type QuotationLineUom = QuotationRequestDetail['lines'][number]['uom'];

/** A person reference as a name. */
export function personName(person: PersonRef | undefined): string | null {
  if (!person) return null;
  if (typeof person === 'string') return null;
  return person.name ?? null;
}
