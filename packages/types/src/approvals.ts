// ─── Approvals inbox (Step 3, ADR-049) ───────────────────────────────────
// `GET /approvals/inbox` — everything waiting on the caller's decision, across modules: only items
// the caller holds the deciding permission for, on projects they can reach, and that a
// segregation-of-duties rule would not stop them deciding (their own journal, request, quote …).

export type ApprovalItemKind =
  | 'INVOICE'
  | 'JOURNAL'
  | 'BILL'
  | 'PAYMENT'
  | 'QUOTATION'
  | 'MATERIAL_REQUEST'
  | 'PROGRESS_REPORT'
  | 'WRITE_OFF'
  | 'REFUND'
  | 'TRANSFER'
  | 'WORKFLOW';

export interface ApprovalItem {
  kind: ApprovalItemKind;
  /** The document's id (for WORKFLOW, the governed document's id). */
  id: string;
  /** Reference or name: "JV-000041", "BILL-000012", "MR-2026-0007". */
  title: string;
  /** One quiet line: who or what it concerns. */
  detail: string | null;
  /** Decimal string when the document carries money. */
  amount: string | null;
  currencyCode: string | null;
  /** ISO timestamp: when it started waiting (submitted, created, or the step became current). */
  waitingSince: string;
  /** Who sent it for a decision. */
  requestedByName: string | null;
  projectId: string | null;
  projectName: string | null;
  /** WORKFLOW only: the governed document's transaction type (PURCHASE_ORDER, VARIATION, …). */
  transactionType: string | null;
  /** WRITE_OFF: the invoice whose page holds the decision; REFUND: the receipt. */
  parentId?: string | null;
}

export interface ApprovalInbox {
  items: ApprovalItem[];
  count: number;
}

// ─── Finance approval settings (ADR-046 §8) ──────────────────────────────
// `GET/PUT /accounting/approval-settings`. Optional approvals as settings, never code. Amounts are
// decimal strings; null means "no approval needed at any amount".

export interface FinanceApprovalSettings {
  /** §2 — a client invoice at or above this total needs Approve before it is issued. */
  invoiceApprovalAbove: string | null;
  /** §3 — a non-PO supplier bill at or above this total needs approval; below it, Save posts. */
  billApprovalAbove: string | null;
  /** §3 — a PO bill matched within the matching tolerance (not exactly) also posts on Save. */
  autoPostToleratedBills: boolean;
  /** §4 — a supplier payment up to this amount is approved on Save; "0.00" = never. */
  paymentAutoApproveUpTo: string;
  /**
   * AR-4 — a write-off up to this amount posts at once; above it a second person approves it.
   * "0.00" = every write-off needs approval. Default "50.00". Optional on save (kept when omitted).
   */
  writeOffApprovalAbove?: string;
}
