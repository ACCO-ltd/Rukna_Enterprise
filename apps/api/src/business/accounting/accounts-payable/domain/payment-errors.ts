import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';

/**
 * ADR-045 — refusals of the award-payment commands carry a machine code in `details.code` (and,
 * except for 403s, `errorCode`), the ADR-044 §12 convention GlobalExceptionFilter forwards.
 */
const MESSAGES: Record<string, string> = {
  PAYMENT_PO_NOT_OPEN: 'The award has no issued purchase order to pay (it must be AWARDED with an OPEN order).',
  PAYMENT_PATH_MISMATCH: 'This award is paid the other way. Change the payment path first.',
  PAYMENT_PATH_LOCKED: 'Money has already been released or paid for this order, so the payment path cannot change.',
  FUNDING_EXCEEDS_ORDER: 'This would pay more than the order. Reduce the amount.',
  ADVANCE_RECIPIENT_CANNOT_RELEASE: 'You cannot release cash to yourself (or approve a release to yourself).',
  ADVANCE_RECIPIENT_INVALID: 'The cash can only go to an active collector of this request.',
  ACCOUNT_REQUIRES_DUAL_CONTROL:
    'This account needs two bank signatories, which a buyer at the counter cannot wait for. Choose the cash box or a mobile-money float.',
  ACCOUNT_NOT_USABLE: 'This account is closed or does not allow payments.',
  CURRENCY_MISMATCH: 'The account is in another currency than the order.',
  'POSTING_ACCOUNT_NOT_CONFIGURED:STAFF_ADVANCE':
    'Set up the STAFF_ADVANCE posting profile (Staff advances account) before releasing buyer cash.',
  GOODS_NOT_RECEIVED: 'Waiting for the site to receive the goods (a posted goods receipt must cover this receipt).',
  RETURN_EXCEEDS_OUTSTANDING: 'The change returned is more than the buyer still holds.',
  APPLICATION_EXCEEDS_OUTSTANDING: 'The amount is more than the advance or the bill still has outstanding.',
  APPLICATION_AMOUNT_INVALID: 'The amount must be positive with at most 2 decimals.',
  APPLICATION_MISMATCH: 'The bill is not for this advance (another order, supplier or currency).',
  ADVANCE_HAS_SETTLEMENTS: 'Part of this cash has been applied or returned. Reverse those first.',
  ADVANCE_NOT_RELEASED: 'This advance has not been released (posted) yet.',
  ADVANCE_ALREADY_RELEASED: 'This advance was already released.',
  ADVANCE_LEGACY: 'This advance was recorded before GL posting and cannot take part in posted settlements.',
  IDEMPOTENCY_KEY_REUSED: 'This request key was already used for a different payment. Reopen the dialog and try again.',
  AMOUNT_INVALID: 'The amount must be positive with at most 2 decimals.',
  DATE_INVALID: 'The date is not a valid calendar date.',
  BANK_GL_MISMATCH: 'The bank GL does not match the account the money left.',
  PAYMENT_SHAPE_INVALID: 'Pay the invoice needs a posted bill on this order with enough outstanding.',
  STORE_DOCUMENT_NOT_SUBMITTED: 'This receipt is no longer waiting to be recorded.',
  STORE_DOCUMENT_PHOTO_DUPLICATE: 'This receipt photo was already sent on another receipt.',
  STORE_DOCUMENT_NOT_COLLECTOR: 'Only a collector of this award can send its receipt.',
  STORE_DOCUMENT_NOT_AWARD_PO: 'Receipts can only be sent for an issued purchase order raised from an award.',
  STORE_DOCUMENT_NOT_UPLOADER: 'Only the person who sent this receipt can change it.',
  RECEIPT_ABOVE_ORDER: 'The receipt is above the order — approve the price exception on the bill first.',
  APPROVAL_REQUIRED: 'This needs workflow approval before it takes effect.',
};

export function paymentMessage(code: string): string {
  return MESSAGES[code] ?? `Segregation-of-duties rule '${code}' prohibits this action.`;
}

export function paymentConflict(code: string, extra: Record<string, unknown> = {}, message = paymentMessage(code)) {
  return new ConflictException({ errorCode: code, message, details: { code, ...extra } });
}

export function paymentForbidden(code: string, message = paymentMessage(code)) {
  return new ForbiddenException({ errorCode: 'FORBIDDEN', message, details: { code } });
}

export function paymentUnprocessable(code: string, extra: Record<string, unknown> = {}, message = paymentMessage(code)) {
  return new UnprocessableEntityException({ errorCode: code, message, details: { code, ...extra } });
}

/** A 2-dp positive money string/number → Decimal-ready string, or null when invalid. */
export function parseMoney(value: string | number | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const text = typeof value === 'number' ? String(value) : value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  if (Number(text) <= 0) return null;
  return text;
}

/** A YYYY-MM-DD (or ISO) date → that calendar day at UTC midnight (`@db.Date`), or null. */
export function parseDateOnly(value: string | undefined | null): Date | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day ? null : d;
}

/** Today in Africa/Mogadishu (UTC+3, no DST) as a calendar day — the prefill, never a posting date by itself. */
export function todayInMogadishu(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 60 * 60_000).toISOString().slice(0, 10);
}
