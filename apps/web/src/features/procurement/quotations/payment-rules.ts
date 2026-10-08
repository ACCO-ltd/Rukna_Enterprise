/**
 * Pure helpers for the payment screens (ADR-045). Nothing here decides policy — the funding cap,
 * segregation of duties and the approval bands are the server's. These read the server's answers
 * (`allowedActions`, `blockers`, a 409's details) and shape them for rendering.
 */

import { ApiError } from '@/lib/api-client';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import type {
  BandHint,
  DraftBlocker,
  PaymentActionName,
  PaymentAdvanceSummary,
  PaymentAllowedAction,
  QuotationPayment,
  StoreDocumentCommandResult,
  StoreDocumentPhoto,
  StoreDocumentSummary,
} from './payment-types';

export function findPaymentAction(
  payment: QuotationPayment | null | undefined,
  name: PaymentActionName,
): PaymentAllowedAction | null {
  return payment?.allowedActions?.find((entry) => entry.action === name) ?? null;
}

/** Offered at all (enabled or disabled with a reason). Absent means the server does not offer it. */
export function offersAction(payment: QuotationPayment | null | undefined, name: PaymentActionName): boolean {
  return findPaymentAction(payment, name) !== null;
}

export function paymentActionEnabled(payment: QuotationPayment | null | undefined, name: PaymentActionName): boolean {
  return findPaymentAction(payment, name)?.enabled === true;
}

/**
 * The one primary finance action for the section, in the order the work happens: finish what
 * is half done, record what is waiting, pay what is unpaid. Disabled actions still count — the
 * button shows with its reason, so finance sees what is in the way rather than nothing.
 */
const PRIMARY_ORDER: PaymentActionName[] = [
  'FINISH_PAYMENT',
  'RECORD_RECEIPT',
  'RELEASE_CASH',
  'PAY_SUPPLIER',
];

/**
 * When nothing is enabled, the disabled action worth showing with its reason — the one that is
 * next in the work, not FINISH_PAYMENT ("nothing to finish"), which the server always lists.
 */
const BLOCKED_ORDER: PaymentActionName[] = ['RELEASE_CASH', 'PAY_SUPPLIER', 'RECORD_RECEIPT'];

export function primaryFinanceAction(payment: QuotationPayment | null | undefined): PaymentAllowedAction | null {
  if (!payment || payment.state === 'SETTLED') return null;
  const enabled = PRIMARY_ORDER.map((name) => findPaymentAction(payment, name)).find((a) => a?.enabled);
  if (enabled) return enabled;
  return (
    BLOCKED_ORDER.map((name) => findPaymentAction(payment, name)).find(
      (a) => a !== null && a.reason !== 'MISSING_PERMISSION',
    ) ?? null
  );
}

/** A blocker's machine code, whatever form the server sent it in. */
export function blockerCode(blocker: DraftBlocker): string {
  return typeof blocker === 'string' ? blocker : blocker.code;
}

export function blockerCodes(blockers: DraftBlocker[] | null | undefined): string[] {
  return (blockers ?? []).map(blockerCode).filter(Boolean);
}

/** Blockers that say "this account set-up is missing": P14 explains and links to set-up. */
export const SETUP_BLOCKERS = new Set([
  'NO_ELIGIBLE_CASH_ACCOUNT',
  'NO_CASH_ACCOUNT',
  'POSTING_ACCOUNT_NOT_CONFIGURED:STAFF_ADVANCE',
  'STAFF_ADVANCE_NOT_CONFIGURED',
]);

/** The approval steps of a band hint, as role names. */
export function bandSteps(hint: BandHint | null | undefined): string[] {
  return (hint?.steps ?? [])
    .map((step) => (typeof step === 'string' ? step : (step.roleRequired ?? step.role ?? step.name ?? '')))
    .filter(Boolean);
}

/**
 * The DoA gate on a payment command: a 409 carrying `approvalInstanceId` (ADR-015). It is not a
 * failure — the document waits for the next approver and the same command is re-driven.
 */
export function gatedInstanceOf(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const id = error.details?.approvalInstanceId;
  return typeof id === 'string' && id ? id : null;
}

/** Fresh v4 UUID — one per dialog open; a retry inside the same open reuses it. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Today in Mogadishu (UTC+3, no DST) as `yyyy-MM-dd` — the default document date (ADR-045 §2). */
export function todayInMogadishu(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** A wire date (`2026-10-08` or a timestamp) as `yyyy-MM-dd`. */
export function wireDay(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

/** `"1000"`, `"1000.5"` → `"1000.00"`, `"1000.50"`; null when not an amount. */
export function toMoneyString(raw: string | null | undefined): string | null {
  const minor = parseMinorUnits(raw ?? null, MONEY_SCALE);
  return minor === null ? null : fromMinorUnits(minor, MONEY_SCALE);
}

/**
 * Typed amount checked against a cap the server stated: `'empty' | 'zero' | 'over'` or null when
 * fine. The server still enforces the cap (R3, R11); this only says it before the tap.
 */
export function amountProblem(raw: string, cap: string | null | undefined): 'empty' | 'zero' | 'over' | null {
  const minor = parseMinorUnits(raw, MONEY_SCALE);
  if (minor === null) return 'empty';
  if (minor <= 0) return 'zero';
  const capMinor = parseMinorUnits(cap ?? null, MONEY_SCALE);
  if (capMinor !== null && minor > capMinor) return 'over';
  return null;
}

/** Advances still holding money, largest first — where change is returned from. */
export function outstandingAdvances(payment: QuotationPayment | null | undefined): PaymentAdvanceSummary[] {
  return (payment?.advances ?? [])
    .filter((advance) => (parseMinorUnits(advance.outstanding, MONEY_SCALE) ?? 0) > 0)
    .sort(
      (a, b) =>
        (parseMinorUnits(b.outstanding, MONEY_SCALE) ?? 0) - (parseMinorUnits(a.outstanding, MONEY_SCALE) ?? 0),
    );
}

/** Who holds the cash, for the copy: the latest advance's recipient. */
export function cashHolderName(payment: QuotationPayment | null | undefined): string | null {
  const advances = payment?.advances ?? [];
  return advances.length > 0 ? (advances[advances.length - 1]!.recipientName ?? null) : null;
}

/** The latest live store document — the one the buyer and finance are working on. */
export function latestStoreDocument(
  payment: QuotationPayment | null | undefined,
  status?: StoreDocumentSummary['status'],
): StoreDocumentSummary | null {
  const docs = (payment?.storeDocuments ?? []).filter((doc) =>
    status ? doc.status === status : doc.status !== 'WITHDRAWN',
  );
  if (docs.length === 0) return null;
  return [...docs].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')).at(-1) ?? null;
}

/** The recorded bill a top-up should apply to, when the server named one on a document. */
export function topUpBillId(payment: QuotationPayment | null | undefined): string | null {
  const recorded = (payment?.storeDocuments ?? []).filter((doc) => doc.status === 'RECORDED' && doc.supplierBillId);
  return recorded.at(-1)?.supplierBillId ?? null;
}

/** The total a record applied from buyer cash or the prepayment, as a 2-dp string (null when none). */
export function appliedTotal(applied: ReadonlyArray<{ amount: string }> | null | undefined): string | null {
  if (!applied || applied.length === 0) return null;
  const minor = applied.reduce((sum, a) => sum + (parseMinorUnits(a.amount, MONEY_SCALE) ?? 0), 0);
  return fromMinorUnits(minor, MONEY_SCALE);
}

export function photoIdOf(photo: StoreDocumentPhoto): string | null {
  return photo.fileId ?? photo.platformFileId ?? null;
}

/** The store document's id from a create / add-page response, whatever its shape. */
export function storeDocumentIdOf(result: StoreDocumentCommandResult | null | undefined): string | null {
  if (!result || typeof result !== 'object') return null;
  const wrapped = (result as { storeDocument?: { id?: unknown } }).storeDocument;
  if (wrapped && typeof wrapped.id === 'string') return wrapped.id;
  const id = (result as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

/** True when the value looks like the payment read model (not a bare supplier payment). */
export function isPaymentReadModel(value: unknown): value is QuotationPayment {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'state' in value &&
      'allowedActions' in value &&
      Array.isArray((value as { allowedActions: unknown }).allowedActions),
  );
}

// ─── The buyer's view (P12) ──────────────────────────────────────────────────────

/** The four steps procurement sees: waiting for money → go pay → receipt sent → settled. */
export type BuyerStage = 'waiting' | 'released' | 'sent' | 'settled';

export function buyerStage(payment: QuotationPayment): BuyerStage {
  if (payment.state === 'SETTLED') return 'settled';
  const submitted = payment.storeDocuments.some((doc) => doc.status === 'SUBMITTED' || doc.status === 'RECORDED');
  if (submitted) return 'sent';
  switch (payment.state) {
    case 'AWAITING_ORDER':
    case 'READY_TO_PAY':
    case 'AWAITING_APPROVAL':
    case 'AWAITING_SIGNATURES':
      return 'waiting';
    default:
      return 'released';
  }
}
