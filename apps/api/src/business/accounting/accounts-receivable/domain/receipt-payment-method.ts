import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * RC-6 / PM-1 — how a client paid, and the proof each method needs before a receipt is recorded.
 * Recorded on `payment_receipts` (`payment_method` plus the instrument columns) and shown on the
 * receipt, its PDF and the client statement. The same method words as supplier payments use.
 */
export const RECEIPT_PAYMENT_METHODS = ['BANK_TRANSFER', 'CHEQUE', 'CASH', 'MOBILE_MONEY', 'CARD'] as const;

export type ReceiptPaymentMethod = (typeof RECEIPT_PAYMENT_METHODS)[number];

/** Mobile-money services a client can pay from. */
export const MOBILE_MONEY_PROVIDERS = ['EVC_PLUS', 'ZAAD', 'SAHAL', 'EDAHAB'] as const;
export const CARD_TYPES = ['VISA', 'MASTERCARD', 'OTHER'] as const;

/** The kind of account (bank_accounts.kind) each method's money lands in (PM-3). */
export const ACCOUNT_KIND_FOR_METHOD: Record<ReceiptPaymentMethod, 'BANK' | 'CASH' | 'MOBILE_WALLET'> = {
  BANK_TRANSFER: 'BANK',
  CHEQUE: 'BANK',
  CARD: 'BANK',
  CASH: 'CASH',
  MOBILE_MONEY: 'MOBILE_WALLET',
};

export interface PaymentDetails {
  instrumentNumber?: string | null;
  issuer?: string | null;
  instrumentDate?: string | null;
  payerName?: string | null;
  payerAccount?: string | null;
  receivedBy?: string | null;
}

/** What is stored: trimmed, numbers upper-cased (so "chq-118" and "CHQ-118" are one cheque), phone in E.164. */
export interface NormalisedDetails {
  instrumentNumber: string | null;
  issuer: string | null;
  instrumentDate: Date | null;
  payerName: string | null;
  payerAccount: string | null;
  receivedBy: string | null;
}

type Field = keyof PaymentDetails;

/** Per method: which fields are required, and what each is called in a message. */
const REQUIRED: Record<ReceiptPaymentMethod, Partial<Record<Field, string>>> = {
  BANK_TRANSFER: {
    issuer: 'the paying bank',
    payerName: "the payer's account name",
    instrumentNumber: 'the transfer reference',
    instrumentDate: 'the value date',
  },
  CHEQUE: {
    instrumentNumber: 'the cheque number',
    issuer: 'the bank the cheque is drawn on',
    instrumentDate: 'the cheque date',
    payerName: 'the name on the cheque',
  },
  MOBILE_MONEY: {
    issuer: 'the mobile-money provider',
    payerAccount: "the sender's phone number",
    instrumentNumber: 'the transaction ID',
  },
  CARD: {
    issuer: 'the card type',
    payerAccount: 'the last 4 digits of the card',
    instrumentNumber: 'the authorisation code',
  },
  CASH: {
    instrumentNumber: 'the cash receipt-book number',
    receivedBy: 'who counted the cash',
  },
};

/** The fields a method keeps; anything else sent is dropped (a cheque has no sender phone). */
const KEPT: Record<ReceiptPaymentMethod, Field[]> = {
  BANK_TRANSFER: ['issuer', 'payerName', 'instrumentNumber', 'instrumentDate', 'payerAccount'],
  CHEQUE: ['instrumentNumber', 'issuer', 'instrumentDate', 'payerName'],
  MOBILE_MONEY: ['issuer', 'payerAccount', 'instrumentNumber', 'payerName'],
  CARD: ['issuer', 'payerAccount', 'instrumentNumber'],
  CASH: ['instrumentNumber', 'receivedBy'],
};

const blank = (v: string | null | undefined) => !v || !v.trim();

/** Every problem with the proof given for a method, in plain words; empty when it can be recorded. */
export function paymentDetailProblems(method: ReceiptPaymentMethod, details: PaymentDetails): string[] {
  const problems: string[] = [];
  const missing = Object.entries(REQUIRED[method])
    .filter(([field]) => blank(details[field as Field]))
    .map(([, label]) => label);
  if (missing.length) problems.push(`Enter ${missing.join(', ')}.`);

  if (method === 'MOBILE_MONEY' && !blank(details.issuer) && !MOBILE_MONEY_PROVIDERS.includes(details.issuer as never)) {
    problems.push('Choose a mobile-money provider from the list.');
  }
  if (method === 'CARD' && !blank(details.issuer) && !CARD_TYPES.includes(details.issuer as never)) {
    problems.push('Choose a card type from the list.');
  }
  if (method === 'MOBILE_MONEY' && !blank(details.payerAccount) && !phoneE164(details.payerAccount!)) {
    problems.push("The sender's phone number is not a valid number.");
  }
  if (method === 'CARD' && !blank(details.payerAccount) && !/^\d{4}$/.test(details.payerAccount!.trim())) {
    problems.push('Enter exactly the last 4 digits of the card.');
  }
  if (method === 'BANK_TRANSFER' && !blank(details.payerAccount) && !/^\d{4}$/.test(details.payerAccount!.trim())) {
    problems.push("Enter only the last 4 digits of the payer's account.");
  }
  if (!blank(details.instrumentDate) && Number.isNaN(Date.parse(details.instrumentDate!))) {
    problems.push('The date is not a valid date.');
  }
  return problems;
}

/** The stored form of a method's proof: only the fields it keeps, normalised. */
export function normaliseDetails(method: ReceiptPaymentMethod, details: PaymentDetails): NormalisedDetails {
  const keep = new Set(KEPT[method]);
  const text = (field: Field) => (keep.has(field) && !blank(details[field]) ? details[field]!.trim() : null);
  const number = text('instrumentNumber');
  const account = text('payerAccount');
  const date = text('instrumentDate');
  return {
    instrumentNumber: number ? number.toUpperCase() : null,
    issuer: text('issuer'),
    instrumentDate: date ? new Date(date) : null,
    payerName: text('payerName'),
    payerAccount: account && method === 'MOBILE_MONEY' ? (phoneE164(account) ?? account) : account,
    receivedBy: text('receivedBy'),
  };
}

/** A Somali number by default (+252); a number with its own country code is read as given. */
function phoneE164(raw: string): string | null {
  const parsed = parsePhoneNumberFromString(raw.trim(), 'SO');
  return parsed?.isValid() ? parsed.number : null;
}

/** How a receipt's number reads in a message: "EVC Plus transaction 8842213", "cheque 118204 (Premier Bank)". */
export function describeInstrument(method: string, issuer: string | null, number: string): string {
  const provider: Record<string, string> = { EVC_PLUS: 'EVC Plus', ZAAD: 'Zaad', SAHAL: 'Sahal', EDAHAB: 'eDahab' };
  switch (method) {
    case 'CHEQUE':
      return `Cheque ${number}${issuer ? ` (${issuer})` : ''}`;
    case 'MOBILE_MONEY':
      return `${provider[issuer ?? ''] ?? 'Mobile-money'} transaction ${number}`;
    case 'CARD':
      return `Card authorisation ${number}`;
    case 'CASH':
      return `Cash receipt ${number}`;
    default:
      return `Transfer reference ${number}${issuer ? ` (${issuer})` : ''}`;
  }
}

const PROVIDER_NAMES: Record<string, string> = { EVC_PLUS: 'EVC Plus', ZAAD: 'Zaad', SAHAL: 'Sahal', EDAHAB: 'eDahab' };
const CARD_NAMES: Record<string, string> = { VISA: 'Visa', MASTERCARD: 'Mastercard', OTHER: 'Card' };

/** The proof as printed on the receipt PDF, one line each: "Cheque no. 118204 · Premier Bank · dated 15 Nov 2026". */
export function paymentDetailLines(
  method: string | null,
  r: { instrumentNumber: string | null; issuer: string | null; instrumentDate: Date | null; payerName: string | null; payerAccount: string | null; receivedBy: string | null },
): string[] {
  const date = r.instrumentDate ? r.instrumentDate.toISOString().slice(0, 10) : null;
  const lines: Array<string | null> = (() => {
    switch (method) {
      case 'CHEQUE':
        return [r.instrumentNumber && `Cheque no. ${r.instrumentNumber}${r.issuer ? ` · ${r.issuer}` : ''}`, date && `Cheque date ${date}`, r.payerName && `Drawn by ${r.payerName}`];
      case 'MOBILE_MONEY':
        return [r.instrumentNumber && `${PROVIDER_NAMES[r.issuer ?? ''] ?? 'Mobile money'} transaction ${r.instrumentNumber}`, r.payerAccount && `From ${r.payerAccount}${r.payerName ? ` (${r.payerName})` : ''}`];
      case 'CARD':
        return [r.issuer && r.payerAccount && `${CARD_NAMES[r.issuer] ?? r.issuer} ending ${r.payerAccount}`, r.instrumentNumber && `Authorisation ${r.instrumentNumber}`];
      case 'CASH':
        return [r.instrumentNumber && `Cash receipt no. ${r.instrumentNumber}`, r.receivedBy && `Counted by ${r.receivedBy}`];
      case 'BANK_TRANSFER':
        return [r.instrumentNumber && `Transfer reference ${r.instrumentNumber}`, (r.issuer || r.payerName) && `From ${[r.payerName, r.issuer].filter(Boolean).join(', ')}${r.payerAccount ? ` ****${r.payerAccount}` : ''}`, date && `Value date ${date}`];
      default:
        return [];
    }
  })();
  return lines.filter((l): l is string => Boolean(l));
}
