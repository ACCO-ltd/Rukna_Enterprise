// ─── Finance Home (Step 4, ADR-047 §4) ────────────────────────────────────
// `GET /finance/home` — the finance team's dashboard. Each section is present only for a caller who
// may read it (null otherwise). Amounts are decimal strings in the base currency (ADR-024: USD).

export type AgingBucketKey = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';

export interface AgingBucket {
  key: AgingBucketKey;
  amount: string;
  count: number;
}

export interface FinanceHomeCash {
  total: string;
  accounts: Array<{ bankAccountId: string; bankName: string; accountName: string; balance: string }>;
}

export interface FinanceHomeReceivables {
  outstanding: string;
  overdue: string;
  /** Unpaid issued invoices by days past due; `current` = not yet due. */
  aging: AgingBucket[];
  /** The clients owing the most overdue money, largest first (at most 5). */
  topOverdue: Array<{ clientId: string; clientName: string; overdue: string; oldestDaysLate: number }>;
}

export interface FinanceHomePayables {
  outstanding: string;
  overdue: string;
  /** Bills falling due in the next 7 days (not yet overdue). */
  dueThisWeek: string;
  dueThisWeekCount: number;
}

export interface FinanceHomeMonth {
  /** First and last day of the current month (YYYY-MM-DD). */
  from: string;
  to: string;
  invoiced: string;
  collected: string;
  paid: string;
}

export interface FinanceHome {
  asOf: string;
  cash: FinanceHomeCash | null;
  receivables: FinanceHomeReceivables | null;
  payables: FinanceHomePayables | null;
  month: FinanceHomeMonth | null;
}

// ─── Aging reports (Step 6) ──────────────────────────────────────────────
// `GET /finance/aging/:side` — what clients owe (receivables) or what is owed to suppliers
// (payables), by party and by days past due, as of today. Amounts are decimal strings (USD).

export type AgingSide = 'receivables' | 'payables';

export interface AgingDocument {
  id: string;
  /** The document's number: invoice number, or the bill's number (else the supplier's invoice number). */
  number: string | null;
  date: string;
  dueDate: string;
  outstanding: string;
  daysLate: number;
  bucket: AgingBucketKey;
  /** Carried in from the previous system rather than posted here. */
  opening: boolean;
}

export interface AgingPartyRow {
  partyId: string;
  partyCode: string;
  partyName: string;
  buckets: Record<AgingBucketKey, string>;
  total: string;
  oldestDaysLate: number;
  documents: AgingDocument[];
  /** AG-2 (receivables) — money the client paid ahead, held on account; lowers what they owe. */
  onAccount?: string;
  /** total − onAccount: what the client owes, as their statement shows it. */
  netBalance?: string;
  /** AG-3 (receivables) — retention held back on their contracts, due later on a release invoice. */
  retentionHeld?: string;
}

export interface AgingReport {
  side: AgingSide;
  asOf: string;
  /** AG-1 — true when the report is as of a past day (balances rebuilt to that day). */
  historical?: boolean;
  totals: Record<AgingBucketKey, string>;
  total: string;
  /** Largest balance first. */
  rows: AgingPartyRow[];
  onAccount?: string;
  netTotal?: string;
  retentionHeld?: string;
  /**
   * AG-4 — the control account in the ledger on the same day (AR or AP), and whether the aging
   * total agrees with it. Null when the chart has no such account.
   */
  ledger?: { balance: string; difference: string; agrees: boolean } | null;
}

// ─── VAT report (Step 6) ─────────────────────────────────────────────────
// `GET /finance/vat-report?from&to` — output VAT for a period, read from the ledger: every posted
// line on a VAT_OUTPUT_PAYABLE account, traced to the invoice or credit note behind it. Input VAT
// on supplier bills is non-recoverable (ACC-TAX-001), so it is shown for information only.

export type VatLineKind = 'INVOICE' | 'CREDIT_NOTE' | 'ADJUSTMENT';

export interface VatReportLine {
  journalEntryId: string;
  journalNumber: string | null;
  accountingDate: string;
  kind: VatLineKind;
  /** The invoice or credit note; null for a journal posted straight to the VAT account. */
  documentId: string | null;
  documentNumber: string | null;
  partyName: string | null;
  /** Net amount the VAT is charged on (negative for a credit note or a reversal); null for an adjustment. */
  taxableAmount: string | null;
  /** Percent, e.g. "5.0000"; null for an adjustment. */
  rate: string | null;
  /** VAT owed by this line: credit less debit on the VAT account (negative reduces what is owed). */
  vat: string;
  /** This line reverses an earlier posting. */
  reversal: boolean;
}

export interface VatReport {
  from: string;
  to: string;
  output: {
    byRate: Array<{ rate: string; taxable: string; vat: string }>;
    invoices: { count: number; taxable: string; vat: string };
    creditNotes: { count: number; taxable: string; vat: string };
    adjustments: { count: number; vat: string };
    /** Output VAT for the period: what the ledger's VAT account moved by. */
    total: string;
    lines: VatReportLine[];
  };
  input: { count: number; taxable: string; vat: string };
  /** The VAT account's credit balance at the end of `to`: owed and not yet paid over. */
  closingBalance: string;
}
