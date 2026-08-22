/**
 * ADR-022 — ACCO Authority Matrix, expressed as data.
 *
 * These are the role names the seeded approval chains reference. They are a **starting set**, not a
 * fixed list: roles live in the per-org Role registry and more can be added in Settings when the
 * org needs them. Role *assignment* (who holds CFO) is org data, not seeded here.
 *
 * Confirmed with ACCO 2026-08-22 (revises the original CONST-DOA-001 list): the procurement role is
 * **Procurement Manager** (not Officer); there is **no Store Keeper** and **no Quantity Surveyor**
 * role; the apex is **CEO** (not Group CEO) with **no Board Chairman**.
 */
export const ACCO_ROLES = {
  CONSTRUCTION_DIRECTOR: 'CONSTRUCTION_DIRECTOR', // org-wide construction lead + Department Head; owns BOQ (absorbs QS)
  PROJECT_MANAGER: 'PROJECT_MANAGER', // single project authority (Project Engineer / Manager / Coordinator)
  SITE_ENGINEER: 'SITE_ENGINEER',
  PROCUREMENT_MANAGER: 'PROCUREMENT_MANAGER', // runs procurement (also covers stores — no separate Store Keeper role)
  ACCOUNTANT: 'ACCOUNTANT',
  FINANCE_OFFICER: 'FINANCE_OFFICER', // the Finance ladder's middle tier (Accountant → Finance Officer → CFO)
  CFO: 'CFO',
  CEO: 'CEO', // apex approver
  SYSTEM_ADMINISTRATOR: 'SYSTEM_ADMINISTRATOR', // no business-transaction approval authority
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
