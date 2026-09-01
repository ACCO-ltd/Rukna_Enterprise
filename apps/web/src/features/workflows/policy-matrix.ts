/**
 * The approved ACCO first-release approval-policy matrix, mirrored on the frontend.
 *
 * Source of truth: `docs/reference/acco-approval-policy-matrix.md` (APPROVED, Eng Ahmed Shirie)
 * and the backend `policy-transition-registry.ts`, which is what the API actually enforces.
 * Only the four transaction types below can be authored or activated; everything else remains
 * PENDING and is not offered in the authoring surface.
 *
 * The `transition` here is the ONE fixed `from → to` the backend accepts for that transaction
 * type. The add-rule form does not free-text `fromState`/`toState`; it constrains them to this
 * pair, so a draft rule cannot be authored on a transition the server will later reject.
 */

export interface PolicyMatrixEntry {
  /** Human label for the transaction type. */
  label: string;
  /** The single approved lifecycle transition, e.g. `DRAFT → SUBMITTED`. */
  transition: string;
  /** The machine states the transition maps to — what the rule's configuration carries. */
  fromState: string;
  toState: string;
  /** What the amount bands are measured against; `null` when bands do not apply. */
  basis: string | null;
  /** The approved approval chain, by amount band where relevant. */
  chain: string;
}

/**
 * Keyed by `WorkflowTransactionType`. Kept as a plain record (not the enum) so this module
 * has no runtime dependency and the keys read as the API sends them.
 */
export const ACCO_POLICY_MATRIX: Record<string, PolicyMatrixEntry> = {
  MATERIAL_REQUEST: {
    label: 'Material request',
    transition: 'DRAFT → SUBMITTED',
    fromState: 'DRAFT',
    toState: 'SUBMITTED',
    basis: 'Reporting USD',
    chain: 'Project Manager → Procurement Manager',
  },
  PURCHASE_ORDER: {
    label: 'Purchase order',
    transition: 'DRAFT → SUBMITTED',
    fromState: 'DRAFT',
    toState: 'SUBMITTED',
    basis: 'Net USD',
    chain: '0–10k: Procurement Manager · 10k–50k: Procurement Manager → CFO · >50k: Procurement Manager → CFO → CEO',
  },
  SUPPLIER_PAYMENT: {
    label: 'Supplier payment',
    transition: 'DRAFT → SUBMITTED',
    fromState: 'DRAFT',
    toState: 'SUBMITTED',
    basis: 'Gross payable USD',
    chain: 'Finance Manager → CFO · CEO above the approved CFO band',
  },
  BOQ_BASELINE: {
    label: 'BOQ baseline',
    transition: 'DRAFT → BASELINED',
    fromState: 'DRAFT',
    toState: 'BASELINED',
    basis: null,
    chain: 'QS Manager → Commercial Manager',
  },
};

/** The transaction types that can be authored, in matrix order. */
export const AUTHORABLE_TRANSACTION_TYPES = Object.keys(ACCO_POLICY_MATRIX);

/** The approved matrix entry for a transaction type, or null when it is not authorable. */
export function policyMatrixFor(transactionType: string | null | undefined): PolicyMatrixEntry | null {
  if (!transactionType) return null;
  return ACCO_POLICY_MATRIX[transactionType] ?? null;
}
