import { parsePhoneNumberFromString } from 'libphonenumber-js';

import { MOBILE_MONEY_PROVIDERS, RECEIPT_PAYMENT_METHODS } from '../../accounts-receivable/domain/receipt-payment-method.js';

/**
 * SP-1 / SP-3 — what a supplier payment must satisfy before it is saved, and the proof of the
 * money that left. Proof is optional for every method (the receipts rule, PM-1): what is given is
 * checked and kept in one shape, so a cheque number or transfer reference is never used twice.
 */

/** The methods a payment raised from the payments screen may use — the receipts' own words. */
export const SUPPLIER_PAYMENT_METHODS = RECEIPT_PAYMENT_METHODS;
export type SupplierPaymentMethod = (typeof SUPPLIER_PAYMENT_METHODS)[number];

export interface PaymentRuleProblem {
  errorCode: string;
  message: string;
}

const day = (iso: string) => iso.slice(0, 10);

/**
 * ADR-024 USD only. The accounting date is free either side of the payment date on purpose: a
 * payment the bank processed on the 1st can be booked to the month before (the form's own rule).
 */
export function paymentProblem(p: { currencyCode: string }): PaymentRuleProblem | null {
  if (p.currencyCode !== 'USD') {
    return { errorCode: 'CURRENCY_NOT_SUPPORTED', message: 'Payments are made in US dollars (USD) only.' };
  }
  return null;
}

/** A reversal is dated on or after the day the payment entered the ledger (its accounting date). */
export function paymentReversalProblem(accountingDate: Date, reversalDate: string): PaymentRuleProblem | null {
  const posted = accountingDate.toISOString().slice(0, 10);
  if (day(reversalDate) < posted) {
    return { errorCode: 'REVERSAL_BEFORE_PAYMENT', message: `The reversal date cannot be before the payment date (${posted}).` };
  }
  return null;
}

export interface PaymentProof {
  /** The cheque number, transfer reference, transaction ID or cash receipt number. */
  bankReference?: string | null;
  instrumentDate?: string | null;
  provider?: string | null;
  payeeAccount?: string | null;
  payeeName?: string | null;
}

export interface NormalisedProof {
  bankReference: string | null;
  instrumentDate: Date | null;
  provider: string | null;
  payeeAccount: string | null;
  payeeName: string | null;
}

type Field = keyof PaymentProof;

/** The fields each method keeps; anything else sent is dropped (a cheque has no phone number). */
const KEPT: Record<string, Field[]> = {
  BANK_TRANSFER: ['bankReference', 'payeeAccount', 'payeeName'],
  CHEQUE: ['bankReference', 'instrumentDate', 'payeeName'],
  MOBILE_MONEY: ['bankReference', 'provider', 'payeeAccount', 'payeeName'],
  CARD: ['bankReference'],
  CASH: ['bankReference', 'payeeName'],
};

const blank = (v: string | null | undefined) => !v || !v.trim();

function phoneE164(raw: string): string | null {
  const parsed = parsePhoneNumberFromString(raw.trim(), 'SO');
  return parsed?.isValid() ? parsed.number : null;
}

/** Every problem with the proof given, in plain words; empty when it can be saved. */
export function paymentProofProblems(method: string, proof: PaymentProof): string[] {
  const problems: string[] = [];
  if (method === 'MOBILE_MONEY' && !blank(proof.provider) && !MOBILE_MONEY_PROVIDERS.includes(proof.provider as never)) {
    problems.push('Choose a mobile-money provider from the list.');
  }
  if (method === 'MOBILE_MONEY' && !blank(proof.payeeAccount) && !phoneE164(proof.payeeAccount!)) {
    problems.push("The supplier's phone number is not a valid number.");
  }
  if (method === 'CHEQUE' && !blank(proof.instrumentDate) && Number.isNaN(Date.parse(proof.instrumentDate!))) {
    problems.push('The cheque date is not a valid date.');
  }
  return problems;
}

/** The stored form: only the fields the method keeps, trimmed; numbers upper-cased, phone E.164. */
export function normaliseProof(method: string, proof: PaymentProof): NormalisedProof {
  const keep = new Set(KEPT[method] ?? ['bankReference']);
  const text = (field: Field) => (keep.has(field) && !blank(proof[field]) ? proof[field]!.trim() : null);
  const reference = text('bankReference');
  const account = text('payeeAccount');
  const date = text('instrumentDate');
  return {
    bankReference: reference ? reference.toUpperCase() : null,
    instrumentDate: date ? new Date(date) : null,
    provider: text('provider'),
    payeeAccount: account && method === 'MOBILE_MONEY' ? (phoneE164(account) ?? account) : account,
    payeeName: text('payeeName'),
  };
}

const PROVIDER_NAMES: Record<string, string> = { EVC_PLUS: 'EVC Plus', ZAAD: 'Zaad', SAHAL: 'Sahal', EDAHAB: 'eDahab' };

/** How a reference reads in a refusal: "cheque 004512", "EVC Plus transaction 88421". */
export function describeReference(method: string, reference: string, provider?: string | null): string {
  switch (method) {
    case 'CHEQUE':
      return `Cheque ${reference}`;
    case 'MOBILE_MONEY':
      return `${PROVIDER_NAMES[provider ?? ''] ?? 'Mobile-money'} transaction ${reference}`;
    case 'CASH':
      return `Cash receipt ${reference}`;
    case 'CARD':
      return `Card reference ${reference}`;
    default:
      return `Transfer reference ${reference}`;
  }
}
