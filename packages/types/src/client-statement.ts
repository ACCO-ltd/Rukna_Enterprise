/**
 * AR-3 — `GET /finance/clients/:clientId/statement?from&to`: a client's statement of account
 * across every project and every hand-typed sale. Read from the receivables documents (invoices,
 * credit notes, receipts and their reversals) so it covers history posted before ledger lines
 * carried the client. Amounts are decimal strings; a positive balance is what the client owes.
 */
export type ClientStatementLineKind =
  | 'OPENING_BALANCE'
  | 'INVOICE'
  | 'INVOICE_REVERSAL'
  | 'CREDIT_NOTE'
  | 'CREDIT_NOTE_REVERSAL'
  | 'RECEIPT'
  | 'RECEIPT_REVERSAL';

export interface ClientStatementLine {
  date: string;
  kind: ClientStatementLineKind;
  /** The document the line comes from (invoice, credit note's invoice, or receipt). */
  documentId: string;
  /** INV-000005, CN-000002, RCP-000017; null for an unnumbered opening item. */
  reference: string | null;
  /** Project name, invoice source or payment reference. */
  description: string | null;
  debit: string | null;
  credit: string | null;
  /** Running balance after this line. */
  balance: string;
}

export interface ClientStatement {
  client: { id: string; name: string; code: string | null };
  from: string;
  to: string;
  /** What the client owed at the start of `from`. */
  openingBalance: string;
  lines: ClientStatementLine[];
  totals: { debits: string; credits: string };
  /** What the client owes at the end of `to` (opening + debits − credits). */
  closingBalance: string;
  /** Today, not as at `to`: open invoice balances by days past due, and cash held on account. */
  aging: { current: string; d1_30: string; d31_60: string; d61_90: string; d90_plus: string };
  onAccount: string;
}
