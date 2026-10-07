import { SLA_AMBER_MINUTES, SLA_RED_MINUTES, isWithinWorkingHours, waitingMinutes } from './quotation-sla.policy.js';

/**
 * ADR-044 phase 2 — what the WhatsApp alerts to staff say and when the SLA ones are due. Pure.
 *
 * Templates (Somali, registered at Meta under `en`; texts in docs/integrations/whatsapp-templates.md):
 *
 *   QUOTE_READY       {{1}} QR no · {{2}} MR no · {{3}} project · {{4}} quote count   → /finance/quotes/{id}
 *   QUOTE_REMINDER    {{1}} QR no · {{2}} MR no · {{3}} waiting ("2 saacadood")        → /finance/quotes/{id}
 *   QUOTE_ESCALATION  {{1}} QR no · {{2}} MR no · {{3}} project · {{4}} waiting        → /finance/quotes/{id}
 *   QUOTE_CHOSEN      {{1}} store · {{2}} MR no · {{3}} who pays                       → /procurement/quotes/{id}
 *   QUOTE_ANOTHER     {{1}} MR no · {{2}} finance's note                                → /procurement/quotes/{id}
 *
 * The button is a dynamic URL whose suffix is the request id. Never a price or a total.
 */

export type QuotationAlertPurpose =
  | 'QUOTE_READY'
  | 'QUOTE_REMINDER'
  | 'QUOTE_ESCALATION'
  | 'QUOTE_CHOSEN'
  | 'QUOTE_ANOTHER';

/** The `resourceType` of quotation alerts on OutboundMessage. */
export const QUOTATION_MESSAGE_RESOURCE = 'quotation_request';

/** Meta's limit for one body parameter is generous; our texts stay short and readable on a phone. */
export const PARAM_MAX_LENGTH = 60;
/** Finance's note is the one free-text parameter. */
export const NOTE_MAX_LENGTH = 200;
const MISSING = '-';

/**
 * A value safe as a template parameter: Meta refuses newlines, tabs and runs of 4+ spaces, and an
 * empty parameter. Every whitespace run becomes one space; the result is trimmed, cut to `max`
 * characters (ending with '…') and never empty.
 */
export function sanitiseTemplateParam(value: string | number | null | undefined, max = PARAM_MAX_LENGTH): string {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return MISSING;
  const chars = [...text];
  if (chars.length <= max) return text;
  return `${chars.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…`;
}

/** Waiting time in Somali: "45 daqiiqo", "1 saac", "2 saacadood" (whole hours, rounded down). */
export function waitingTextSo(minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes));
  if (whole < 60) return `${whole} daqiiqo`;
  const hours = Math.floor(whole / 60);
  return hours === 1 ? '1 saac' : `${hours} saacadood`;
}

/** Who pays, in Somali. */
export function paymentPathTextSo(path: 'BUYER_CASH' | 'FINANCE_PAYS_SUPPLIER' | null | undefined): string {
  if (path === 'BUYER_CASH') return 'Iibsaduhu kaash ayuu bixinayaa';
  if (path === 'FINANCE_PAYS_SUPPLIER') return 'Maaliyadda ayaa bixinaysa';
  return MISSING;
}

export interface QuotationAlertFacts {
  number: string;
  mrNumber: string;
  projectName?: string | null;
  quoteCount?: number;
  waitingMinutes?: number;
  storeName?: string | null;
  paymentPath?: 'BUYER_CASH' | 'FINANCE_PAYS_SUPPLIER' | null;
  note?: string | null;
}

/** The template body parameters for a purpose, in order, each sanitised. */
export function alertBodyParams(purpose: QuotationAlertPurpose, f: QuotationAlertFacts): string[] {
  const p = (v: string | number | null | undefined) => sanitiseTemplateParam(v);
  switch (purpose) {
    case 'QUOTE_READY':
      return [p(f.number), p(f.mrNumber), p(f.projectName), p(f.quoteCount ?? 0)];
    case 'QUOTE_REMINDER':
      return [p(f.number), p(f.mrNumber), p(waitingTextSo(f.waitingMinutes ?? 0))];
    case 'QUOTE_ESCALATION':
      return [p(f.number), p(f.mrNumber), p(f.projectName), p(waitingTextSo(f.waitingMinutes ?? 0))];
    case 'QUOTE_CHOSEN':
      return [p(f.storeName), p(f.mrNumber), p(paymentPathTextSo(f.paymentPath))];
    case 'QUOTE_ANOTHER':
      return [p(f.mrNumber), sanitiseTemplateParam(f.note, NOTE_MAX_LENGTH)];
  }
}

/** Selector alerts open the finance decision screen; collector alerts the procurement screen. */
export function isSelectorAlert(purpose: QuotationAlertPurpose): boolean {
  return purpose === 'QUOTE_READY' || purpose === 'QUOTE_REMINDER' || purpose === 'QUOTE_ESCALATION';
}

/**
 * The decision round a selector alert belongs to: the send count plus the send instant. A send
 * after "ask another" (count + 1) and a re-decision (new sentAt) each start a new round; an award
 * withdrawn back to the same round does not.
 */
export function decisionRound(request: { sendCount: number; sentAt: Date | null }): string {
  return `${request.sendCount}.${request.sentAt?.getTime() ?? 0}`;
}

/** One alert per (request, purpose, round, recipient). */
export function alertIdempotencyKey(requestId: string, purpose: QuotationAlertPurpose, round: string, userId: string): string {
  return `quotation-wa:${requestId}:${purpose}:${round}:${userId}`;
}

/** The round segment of an alert key (see alertIdempotencyKey), or null for a foreign key. */
export function roundOfKey(key: string): string | null {
  const parts = key.split(':');
  return parts.length === 5 && parts[0] === 'quotation-wa' ? parts[3] : null;
}

export interface SlaAlertsDue {
  reminder: boolean;
  escalation: boolean;
  waitingMinutes: number;
}

/**
 * Which SLA alerts are due for a request at `now`: only while AWAITING_DECISION with a send time;
 * reminder at ≥ 2 working hours, escalation at ≥ 4 (clock hours when urgent). A non-urgent request
 * is never chased outside working hours (its clock is stopped then anyway; this also covers a job
 * that missed the moment and runs at night).
 */
export function slaAlertsDue(
  request: { status: string; sentAt: Date | null; urgent: boolean },
  now: Date,
): SlaAlertsDue {
  const none = { reminder: false, escalation: false, waitingMinutes: 0 };
  if (request.status !== 'AWAITING_DECISION' || !request.sentAt) return none;
  const minutes = waitingMinutes(request.sentAt, now, { urgent: request.urgent });
  if (!request.urgent && !isWithinWorkingHours(now)) return { ...none, waitingMinutes: minutes };
  return {
    reminder: minutes >= SLA_AMBER_MINUTES,
    escalation: minutes >= SLA_RED_MINUTES,
    waitingMinutes: minutes,
  };
}

/**
 * The dispatcher's last check before an alert goes out (DispatchGuard): null = still wanted, else
 * plain words for the delivery log. Selector alerts need the request still AWAITING_DECISION in the
 * same round; "chosen" needs it still AWARDED; "another" still RETURNED.
 */
export function alertStillWanted(
  purpose: QuotationAlertPurpose,
  key: string,
  request: { status: string; sendCount: number; sentAt: Date | null } | null,
): string | null {
  if (!request) return 'Not sent: the quotation request no longer exists.';
  if (request.status === 'CANCELLED') return 'Not sent: the quotation request was cancelled.';
  if (isSelectorAlert(purpose)) {
    if (request.status !== 'AWAITING_DECISION') return 'Not sent: finance already decided.';
    if (roundOfKey(key) !== decisionRound(request)) return 'Not sent: the quotes were sent again since.';
    return null;
  }
  if (purpose === 'QUOTE_CHOSEN' && request.status !== 'AWARDED') return 'Not sent: the choice was withdrawn.';
  if (purpose === 'QUOTE_ANOTHER' && request.status !== 'RETURNED') return 'Not sent: the quotes were sent again since.';
  return null;
}
