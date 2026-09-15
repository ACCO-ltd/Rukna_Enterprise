/**
 * ADR-022 — ACCO Authority Matrix, expressed as data.
 *
 * These are the role names the seeded approval chains reference. The string VALUES are the friendly
 * `Role.name` values of ACCO's assignable roles (revised 2026-09-15), so an approval step's
 * `roleRequired` resolves against a real holder's JWT roles once the (currently dormant) engine is
 * activated. Keys stay SCREAMING_SNAKE for stable references; only the values are the display names.
 * Role *assignment* (who holds CFO) is org data, not seeded here.
 *
 * Revised scheme: the old `ACCOUNTANT` tier is merged into `Finance Officer` (removed here), and the
 * seeds' former `COMMERCIAL_MANAGER` step maps to `Construction Director` (which absorbs the QS /
 * commercial function) — both PROVISIONAL pending Eng Ahmed's confirmation of the final chains.
 * Because the engine is dormant they change no live decision; a renamed step may leave two adjacent
 * identical approvers until the chain is re-cut.
 */
export const ACCO_ROLES = {
  CONSTRUCTION_DIRECTOR: 'Construction Director', // org-wide construction lead; owns BOQ (absorbs QS/commercial)
  PROJECT_MANAGER: 'Project Manager', // single-project authority
  SITE_ENGINEER: 'Site Engineer',
  PROCUREMENT_MANAGER: 'Procurement Manager', // runs company-wide procurement (also covers stores)
  FINANCE_OFFICER: 'Finance Officer', // the whole finance function (merges the old Accountant + Finance Officer)
  CFO: 'CFO',
  CEO: 'CEO', // apex approver
  SYSTEM_ADMINISTRATOR: 'SYSTEM_ADMINISTRATOR', // sentinel — no approval authority; never assigned to a holder
} as const;

export type AccoRole = (typeof ACCO_ROLES)[keyof typeof ACCO_ROLES];

/**
 * One amount band of a per-command approval ladder. The band is half-open `[minAmount, maxAmount)`
 * in USD: minAmount inclusive, maxAmount exclusive, null = unbounded on that side. `steps` is the
 * ordered, cumulative approver chain for documents whose value falls in this band.
 */
export interface ValueBand {
  name: string;
  minAmount: string | null;
  maxAmount: string | null;
  steps: AccoRole[];
}

// The .01 boundaries are faithful to CONST-DOA-005's ranges: "≤ $100" includes 100.00, and
// "$100.01 – $1,000" starts at 100.01. Money is 2dp, so a max of 100.01 (exclusive) admits up to
// 100.00 and hands 100.01 to the next band.
const R = ACCO_ROLES;

/**
 * CONST-DOA-005 — Purchase Orders. Chains are cumulative: each higher band routes through the
 * lower approvers before its own authority signs off.
 *   ≤ $100            Department Head (= Construction Director)   [PM is an accepted alternative]
 *   $100.01 – $1,000  + Finance confirmation
 *   $1,000.01 – $50k  + CFO (merged band — no separate $10k control for POs)
 *   > $50,000         + CEO   (ACCO 2026-08-22: no Board Chairman tier)
 */
export function accoPurchaseOrderBands(): ValueBand[] {
  return [
    { name: 'PO ≤ $100', minAmount: null, maxAmount: '100.01', steps: [R.CONSTRUCTION_DIRECTOR] },
    {
      name: 'PO $100.01–$1,000',
      minAmount: '100.01',
      maxAmount: '1000.01',
      steps: [R.CONSTRUCTION_DIRECTOR, R.FINANCE_OFFICER],
    },
    {
      name: 'PO $1,000.01–$50,000',
      minAmount: '1000.01',
      maxAmount: '50000.01',
      steps: [R.CONSTRUCTION_DIRECTOR, R.FINANCE_OFFICER, R.CFO],
    },
    {
      name: 'PO > $50,000',
      minAmount: '50000.01',
      maxAmount: null,
      steps: [R.CONSTRUCTION_DIRECTOR, R.FINANCE_OFFICER, R.CFO, R.CEO],
    },
  ];
}

/**
 * ADR-026 CONST-VAR-010 — VariationOrder internal approval (PENDING_INTERNAL → INTERNAL_APPROVED).
 *
 * Memo Q6: **no new authority matrix** — the VO reuses ACCO's existing thresholds. So this REUSES
 * the PO bands verbatim (same roles, same cut-offs), banded on the VO's `|net price|` so a large
 * omission is governed like a large addition. Seeded INACTIVE like every ADR-022 chain: with no
 * active binding the gate resolves to null and internal approval proceeds unchanged.
 */
export function accoVariationOrderBands(): ValueBand[] {
  return accoPurchaseOrderBands().map((b) => ({
    ...b,
    // Rename so the seeded WorkflowDefinition is distinguishable from the PO band it mirrors.
    name: b.name.replace(/^PO /, 'VO '),
  }));
}

/**
 * CONST-DOA-005 — Supplier Payments. (Payment *release* additionally needs two bank signatories —
 * a separate dual control, Phase 4.)
 *   ≤ $1,000            Finance Officer (after AP certification)
 *   $1,000.01 – $10,000 + CFO
 *   > $10,000           + Group CEO
 */
export function accoSupplierPaymentBands(): ValueBand[] {
  return [
    { name: 'Payment ≤ $1,000', minAmount: null, maxAmount: '1000.01', steps: [R.FINANCE_OFFICER] },
    {
      name: 'Payment $1,000.01–$10,000',
      minAmount: '1000.01',
      maxAmount: '10000.01',
      steps: [R.FINANCE_OFFICER, R.CFO],
    },
    {
      name: 'Payment > $10,000',
      minAmount: '10000.01',
      maxAmount: null,
      steps: [R.FINANCE_OFFICER, R.CFO, R.CEO],
    },
  ];
}
