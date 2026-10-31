import type { BankAccountKind } from '@/features/accounting/types';
import type { ReceiptPaymentMethod } from '@/lib/api-types';

/** RC-6 — how a client paid; the order the form offers them in. Mirrors the API's list. */
export const RECEIPT_PAYMENT_METHODS: readonly ReceiptPaymentMethod[] = [
  'BANK_TRANSFER',
  'CHEQUE',
  'CASH',
  'MOBILE_MONEY',
  'CARD',
];

export function isReceiptPaymentMethod(value: string | null | undefined): value is ReceiptPaymentMethod {
  return RECEIPT_PAYMENT_METHODS.includes(value as ReceiptPaymentMethod);
}

export const MOBILE_MONEY_PROVIDERS = ['EVC_PLUS', 'ZAAD', 'SAHAL', 'EDAHAB'] as const;
export const CARD_TYPES = ['VISA', 'MASTERCARD', 'OTHER'] as const;

/** PM-3 — the kind of account each method's money lands in (the API refuses any other). */
export const ACCOUNT_KIND_FOR_METHOD: Record<ReceiptPaymentMethod, BankAccountKind> = {
  BANK_TRANSFER: 'BANK',
  CHEQUE: 'BANK',
  CARD: 'BANK',
  CASH: 'CASH',
  MOBILE_MONEY: 'MOBILE_WALLET',
};

export type ProofField = 'instrumentNumber' | 'issuer' | 'instrumentDate' | 'payerName' | 'payerAccount' | 'receivedBy';
export type ProofInput = 'text' | 'date' | 'provider' | 'card' | 'phone' | 'last4';
export type ProofValues = Partial<Record<ProofField, string>>;

/**
 * PM-1 — the proof each method asks for, in the order the form shows it. Mirrors the API
 * (domain/receipt-payment-method.ts), which has the final word.
 */
export const PROOF_FIELDS: Record<ReceiptPaymentMethod, { field: ProofField; input: ProofInput; required: boolean }[]> = {
  BANK_TRANSFER: [
    { field: 'instrumentNumber', input: 'text', required: true },
    { field: 'instrumentDate', input: 'date', required: true },
    { field: 'issuer', input: 'text', required: true },
    { field: 'payerName', input: 'text', required: true },
    { field: 'payerAccount', input: 'last4', required: false },
  ],
  CHEQUE: [
    { field: 'instrumentNumber', input: 'text', required: true },
    { field: 'instrumentDate', input: 'date', required: true },
    { field: 'issuer', input: 'text', required: true },
    { field: 'payerName', input: 'text', required: true },
  ],
  MOBILE_MONEY: [
    { field: 'issuer', input: 'provider', required: true },
    { field: 'instrumentNumber', input: 'text', required: true },
    { field: 'payerAccount', input: 'phone', required: true },
    { field: 'payerName', input: 'text', required: false },
  ],
  CARD: [
    { field: 'issuer', input: 'card', required: true },
    { field: 'payerAccount', input: 'last4', required: true },
    { field: 'instrumentNumber', input: 'text', required: true },
  ],
  CASH: [
    { field: 'instrumentNumber', input: 'text', required: true },
    { field: 'receivedBy', input: 'text', required: true },
  ],
};

export type ProofProblem = 'required' | 'last4' | 'phone';

/** What is wrong with each field, before the round-trip; empty when the proof is complete. */
export function proofProblems(method: ReceiptPaymentMethod, values: ProofValues): Partial<Record<ProofField, ProofProblem>> {
  const problems: Partial<Record<ProofField, ProofProblem>> = {};
  for (const { field, input, required } of PROOF_FIELDS[method]) {
    const value = values[field]?.trim() ?? '';
    if (!value) {
      if (required) problems[field] = 'required';
      continue;
    }
    if (input === 'last4' && !/^\d{4}$/.test(value)) problems[field] = 'last4';
    // The API parses the number properly (+252 by default); this only catches the obviously short.
    if (input === 'phone' && value.replace(/\D/g, '').length < 7) problems[field] = 'phone';
  }
  return problems;
}

/** The fields this method keeps, trimmed, for the request body. */
export function proofPayload(method: ReceiptPaymentMethod, values: ProofValues): ProofValues {
  return Object.fromEntries(
    PROOF_FIELDS[method]
      .map(({ field }) => [field, values[field]?.trim() ?? ''] as const)
      .filter(([, value]) => value !== ''),
  );
}

/** PM-4 — a cheque dated after the day it is received is held, and posts when deposited. */
export function isPostDatedCheque(method: string | null | undefined, chequeDate: string | null | undefined, receivedOn: string): boolean {
  return method === 'CHEQUE' && Boolean(chequeDate) && chequeDate!.slice(0, 10) > receivedOn.slice(0, 10);
}
