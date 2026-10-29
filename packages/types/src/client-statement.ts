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
  | 'RECEIPT_REVERSAL'
  | 'WRITE_OFF'
  | 'WRITE_OFF_REVERSAL'
  | 'REFUND'
  | 'REFUND_REVERSAL';

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

/**
 * AR-4 — a client balance written off (bad debt or a small leftover). Up to the organisation's
 * limit it posts at once; above it, it waits (`PENDING_APPROVAL`) for a second person.
 */
export interface ReceivableWriteOffView {
  id: string;
  invoiceId: string;
  /** WO-000001 once posted. */
  writeOffNumber: string | null;
  reason: 'BAD_DEBT' | 'SMALL_BALANCE';
  note: string | null;
  amount: string;
  accountingDate: string;
  status: 'PENDING_APPROVAL' | 'POSTED' | 'REJECTED' | 'REVERSED';
  requestedBy: string;
  requestedByName: string | null;
  requestedAt: string;
  approvedByName: string | null;
  rejectedByName: string | null;
  rejectionReason: string | null;
  reversalReason: string | null;
  reversedAt: string | null;
}

/**
 * AR-5 — client cash held on account paid back from a bank account. Follows the payment rule: up
 * to the payment limit it posts at once; above it, it waits for a second person.
 */
export interface ClientRefundView {
  id: string;
  receiptId: string;
  receiptNumber: string | null;
  bankAccountId: string;
  /** RF-000001 once posted. */
  refundNumber: string | null;
  amount: string;
  refundDate: string;
  reference: string | null;
  reason: string;
  status: 'PENDING_APPROVAL' | 'POSTED' | 'REJECTED' | 'REVERSED';
  requestedBy: string;
  requestedByName: string | null;
  approvedByName: string | null;
  rejectionReason: string | null;
  reversalReason: string | null;
}
