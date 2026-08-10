/**
 * Grouped primary navigation.
 *
 * Only entries backed by live endpoints are enabled. Procurement, Inventory, GL,
 * and several admin screens are declared here so the sidebar renders them as
 * visible-but-disabled placeholders — stakeholders see the roadmap, not a short menu.
 * This is a deliberate UX decision: a grayed-out "Exchange Rates" is honest about
 * what is coming; an absent one looks like the feature was forgotten.
 *
 * `moduleKey` maps to the `MODULE_PERMISSIONS` map in `can.ts` so the sidebar can
 * hide entire sections when the user has no permission to any item within them.
 * (While `PERMISSIONS_ENFORCED = false` this is a no-op.)
 *
 * `labelKey` resolves against the `platform.nav` namespace.
 */

export interface NavItem {
  href: string;
  labelKey: string;
  /** When true the item is shown but non-interactive (future module). */
  disabled?: boolean;
}

/**
 * A collapsible sub-group inside a nav group — one level of nesting, no more.
 *
 * Added in Sprint 5 for Procurement's four Setup screens. Without it that group renders
 * nine flat rows, four of which are administrator-only configuration that most users never
 * open. Inventory (Sprint 7) and HR (Sprint 8) each have the same shape, so this is not a
 * one-off.
 *
 * `permissionKey` is checked with `can()` rather than `moduleVisible()` — a sub-group hides
 * on a single specific permission, where a group hides on any of several.
 */
export interface NavSubGroup {
  /** Translation key in `platform.nav` for the sub-group heading. */
  labelKey: string;
  items: NavItem[];
  /** Collapsed on first render. The user's choice is remembered thereafter. */
  defaultCollapsed?: boolean;
  /** When set, the sub-group renders only if the user holds this permission. */
  permissionKey?: string;
}

export interface NavGroup {
  /** Translation key in `platform.nav` for the group heading. */
  labelKey: string;
  /** Matches a key in `MODULE_PERMISSIONS` for permission gating. */
  moduleKey: string;
  items: NavItem[];
  /** Rendered above `items`, in declaration order. */
  subGroups?: NavSubGroup[];
}

/** Items that appear above the grouped sections — no section header. */
export const STANDALONE_NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'dashboard' },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'portfolio',
    moduleKey: 'portfolio',
    items: [
      { href: '/projects', labelKey: 'projects' },
      { href: '/clients', labelKey: 'clients' },
    ],
  },
  {
    labelKey: 'finance',
    moduleKey: 'finance',
    items: [
      { href: '/receipts', labelKey: 'receipts' },
      { href: '/finance/cash-position', labelKey: 'cashPosition', disabled: true },
    ],
  },
  {
    // Sprint 4. Ordered setup → entry → reporting, which is also the order a new
    // organisation has to do them in: there is nothing to post until the chart of accounts
    // and a fiscal year exist, and nothing to report until something is posted.
    labelKey: 'accounting',
    moduleKey: 'accounting',
    items: [
      { href: '/finance/accounting/chart-of-accounts', labelKey: 'chartOfAccounts' },
      { href: '/finance/accounting/periods', labelKey: 'fiscalPeriods' },
      { href: '/finance/accounting/journals', labelKey: 'journals' },
      { href: '/finance/accounting/trial-balance', labelKey: 'trialBalance' },
      { href: '/finance/accounting/profit-loss', labelKey: 'profitLoss' },
      { href: '/finance/accounting/balance-sheet', labelKey: 'balanceSheet' },
      { href: '/finance/accounting/monthly-comparison', labelKey: 'monthlyComparison' },
      { href: '/finance/accounting/ledger', labelKey: 'accountLedger' },
      // AR. Read-only: an invoice is raised from a certificate, so the create action lives on
      // the IPC page (`POST /invoices/from-ipc` is the only way one exists). Sprint 4 recorded
      // this as blocked by #24, which was wrong — that collision was on /receipts and this
      // controller has always been mounted at /invoices.
      { href: '/finance/accounting/invoices', labelKey: 'clientInvoices' },
      // Read-only. Sprint 4 disabled this entirely on #26, which was over-cautious: only
      // POST /bills needs a supplier. GET /bills and GET /bills/:id work, and Sprint 5's
      // Matching tab (§12.8) has to hang off the detail page. Creating a bill is still
      // blocked and the button on the page says so.
      { href: '/finance/accounting/bills', labelKey: 'supplierBills' },
      // Still fully blocked — POST /payments is the only thing this screen would do.
      { href: '/finance/accounting/payments', labelKey: 'supplierPayments', disabled: true },
    ],
  },
  {
    // Sprint 5. A top-level group at the same level as Finance, per §12.1 — procurement is
    // organisation-wide, not something that lives inside a project workspace.
    //
    // Ordered as the work happens: configure the catalogue, request, order, receive,
    // reconcile against the bill, then read what it committed. Setup comes first and is
    // collapsed, because it is done once and the other five are done daily.
    //
    // There is no Bill Matching item. §12.12's snippet lists one; §12.8 says matching is
    // reached from the supplier bill and explicitly "not as a standalone list", and §12.8
    // is the section that describes the screen. Matching is a tab on the bill detail page.
    labelKey: 'procurement',
    moduleKey: 'procurement',
    subGroups: [
      {
        labelKey: 'procurementSetup',
        defaultCollapsed: true,
        permissionKey: 'manage:procurement-config',
        items: [
          { href: '/procurement/setup/uom', labelKey: 'unitsOfMeasure' },
          { href: '/procurement/setup/material-categories', labelKey: 'materialCategories' },
          { href: '/procurement/setup/spend-categories', labelKey: 'spendCategories' },
          { href: '/procurement/setup/materials', labelKey: 'materials' },
        ],
      },
    ],
    items: [
      { href: '/procurement/requests', labelKey: 'materialRequests' },
      { href: '/procurement/orders', labelKey: 'purchaseOrders' },
      // /procurement/grn, not /procurement/receipts — §12.7 offers both and warns about
      // the clash with Sprint 3's client payment receipts at /receipts. This one cannot
      // be misread.
      { href: '/procurement/grn', labelKey: 'goodsReceipts' },
      { href: '/procurement/commitments', labelKey: 'commitments' },
    ],
  },
  {
    labelKey: 'operations',
    moduleKey: 'operations',
    items: [
      { href: '/operations/inventory', labelKey: 'inventory', disabled: true },
    ],
  },
  {
    labelKey: 'reports',
    moduleKey: 'reports',
    items: [
      { href: '/reports', labelKey: 'reports', disabled: true },
    ],
  },
  {
    labelKey: 'administration',
    moduleKey: 'administration',
    items: [
      { href: '/admin/exchange-rates', labelKey: 'exchangeRates', disabled: true },
      { href: '/admin/users', labelKey: 'users' },
      { href: '/admin/roles', labelKey: 'roles' },
      { href: '/admin/settings', labelKey: 'settings', disabled: true },
      { href: '/admin/workflows', labelKey: 'workflows' },
      { href: '/admin/audit-logs', labelKey: 'auditLogs' },
    ],
  },
];

/**
 * True when `pathname` is at the nav destination or a page nested beneath it.
 * Exact-match for `/dashboard` to avoid it being active on every page.
 */
export function isActiveNavItem(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}
