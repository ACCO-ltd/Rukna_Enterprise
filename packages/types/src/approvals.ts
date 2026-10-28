// ─── Approvals inbox (Step 3, ADR-049) ───────────────────────────────────
// `GET /approvals/inbox` — everything waiting on the caller's decision, across modules: only items
// the caller holds the deciding permission for, on projects they can reach, and that a
// segregation-of-duties rule would not stop them deciding (their own journal, request, quote …).

export type ApprovalItemKind =
  | 'JOURNAL'
  | 'BILL'
  | 'PAYMENT'
  | 'QUOTATION'
  | 'MATERIAL_REQUEST'
  | 'PROGRESS_REPORT'
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
}

export interface ApprovalInbox {
  items: ApprovalItem[];
  count: number;
}
