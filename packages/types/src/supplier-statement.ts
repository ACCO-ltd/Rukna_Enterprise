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

/**
 * AP-4 — a credit the supplier gave against a posted bill (`GET/POST /bills/:billId/debit-notes`,
 * `POST /supplier-debit-notes/:id/reverse`). Posts at once; DN-000001 once posted.
 */
export interface SupplierDebitNoteView {
  id: string;
  billId: string;
  debitNoteNumber: string | null;
  /** The supplier's own credit note number, when they sent one. */
  supplierReference: string | null;
  reason: string;
  accountingDate: string;
  amount: string;
  status: 'POSTED' | 'REVERSED';
  createdBy: string;
  createdAt: string;
  reversedAt: string | null;
  reversalReason: string | null;
}

/**
 * AP-5 — money paid ahead that a supplier paid back (`GET/POST /payments/:paymentId/refunds`,
 * `POST /supplier-refunds/:id/reverse`). Posts at once; SR-000001 once posted.
 */
export interface SupplierRefundView {
  id: string;
  paymentId: string;
  bankAccountId: string;
  refundNumber: string | null;
  refundDate: string;
  amount: string;
  /** The supplier's transfer reference. */
  reference: string | null;
  reason: string;
  status: 'POSTED' | 'REVERSED';
  createdBy: string;
  createdAt: string;
  reversedAt: string | null;
  reversalReason: string | null;
}

/**
 * B-2 — money moved between two of the organisation's own accounts (`/bank-transfers`). Up to the
 * payment limit it posts at once; above it, it waits (`PENDING_APPROVAL`) for a second person.
 */
export interface BankTransferView {
  id: string;
  /** TR-000001 once posted. */
  transferNumber: string | null;
  fromBankAccountId: string;
  fromAccountName: string;
  toBankAccountId: string;
  toAccountName: string;
  amount: string;
  currencyCode: string;
  transferDate: string;
  reference: string | null;
  memo: string | null;
  status: 'PENDING_APPROVAL' | 'POSTED' | 'REJECTED' | 'REVERSED';
  requestedBy: string;
  requestedByName: string | null;
  approvedByName: string | null;
  rejectionReason: string | null;
  reversalReason: string | null;
}
