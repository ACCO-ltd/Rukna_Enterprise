/**
 * AP-3 — `GET /finance/suppliers/:supplierId/statement?from&to`: a supplier's account as the
 * organisation keeps it — every bill, payment and buyer-cash settlement (and each one's
 * reversal) across all projects. Read from the payables documents, like the client statement.
 * Amounts are decimal strings. Columns follow the ledger: a bill is a CREDIT (raises what is
 * owed), a payment a DEBIT. A positive balance is what the organisation owes the supplier; a
 * negative one, money paid ahead that the supplier holds.
 */
export type SupplierStatementLineKind =
  | 'BILL'
  | 'BILL_REVERSAL'
  | 'PAYMENT'
  | 'PAYMENT_REVERSAL'
  | 'BUYER_CASH'
  | 'BUYER_CASH_REVERSAL'
  | 'DEBIT_NOTE'
  | 'DEBIT_NOTE_REVERSAL'
  | 'REFUND'
  | 'REFUND_REVERSAL';

export interface SupplierStatementLine {
  date: string;
  kind: SupplierStatementLineKind;
  /** The document the line opens: the bill (bills, buyer cash, debit notes) or the payment. */
  documentId: string;
  /** BILL-000004 (or the supplier's invoice number until posted), PAY-000002 … */
  reference: string | null;
  /** The supplier's invoice number, the bank reference, or the bill a settlement applies to. */
  description: string | null;
  debit: string | null;
  credit: string | null;
  /** What is owed after this line. */
  balance: string;
}

export interface SupplierStatement {
  supplier: { id: string; name: string; code: string };
  from: string;
  to: string;
  /** What was owed at the start of `from`. */
  openingBalance: string;
  lines: SupplierStatementLine[];
  totals: { debits: string; credits: string };
  /** What is owed at the end of `to` (opening + credits − debits). */
  closingBalance: string;
  /** Today: what is still owed on open bills by days past due (a bill an unposted payment holds still counts). */
  aging: { current: string; d1_30: string; d31_60: string; d61_90: string; d90_plus: string };
  /** Today: payments posted but not yet applied to a bill — money the supplier holds for us. */
  unapplied: string;
  /** Today: payments raised but not yet posted, which will settle open bills when they post. */
  pendingPayments: string;
}
