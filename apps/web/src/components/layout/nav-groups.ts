/**
 * Domain navigation. Each domain is a major product area with its own
 * collapsible section and a stable entry route.
 *
 * Domain → direct destination is the default. A domain's items may additionally carry a
 * `groupKey` to collect one-time configuration under a single labelled sub-section (a quiet
 * micro-label divider, not a second collapsible level) — used by Procurement's "Setup" group
 * so master data reads as configuration set aside from the operational spine, rather than as
 * flat siblings of the daily workflow items. This is a visual grouping only: every item keeps
 * its own route and its own permission gate.
 *
 * Domain-specific configuration lives inside its domain.
 * Global Settings (org profile, integrations) is a separate future section.
 */

export type NavIconKey =
  | 'grid'
  | 'building'
  | 'folder'
  | 'receipt'
  | 'cog'
  | 'pencil'
  | 'chart-bar'
  | 'users'
  | 'clipboard'
  | 'shopping-cart'
  | 'truck'
  | 'trending-up'
  | 'shield'
  | 'git-branch'
  | 'list'
  | 'briefcase'
  | 'file-text'
  | 'book-open'
  | 'credit-card'
  | 'wallet'
  | 'calendar'
  | 'storefront'
  | 'package'
  | 'ruler'
  | 'tag'
  | 'user-gear'
  | 'key'
  | 'check-circle';

export interface NavItem {
  href: string;
  labelKey: string;
  iconKey?: NavIconKey;
  /** Permission required to see this item. */
  permissionKey?: string;
  /**
   * Collects the item under a labelled sub-section inside its domain (e.g. Procurement's
   * `setup`). Items sharing a `groupKey` render together under a `nav.group.<key>` micro-label.
   * Ungrouped items render first, in their declared order; grouped items follow. Purely visual
   * — it changes neither the route nor the permission gate.
   */
  groupKey?: string;
  /**
   * A cross-domain pointer: this item lives in one domain's nav but links to a route that is
   * canonically owned by another domain (e.g. Supplier bills surfaced under Procurement, whose
   * route stays `/finance/accounting/bills` under Finance). Marks intent for readers; the
   * link resolves to the same single destination either way.
   */
  crossLink?: boolean;
  /** Retained for test helpers; hidden in production navigation. */
  disabled?: boolean;
  /**
   * A live count shown beside the label (e.g. Finance's "Quotes to choose"). The key names a
   * count source in `nav-badges.tsx`; the item's own permission gate still decides visibility.
   */
  badge?: NavBadgeKey;
}

/** Live counts a nav item can carry. */
export type NavBadgeKey = 'quotesToChoose';

export interface NavDomain {
  /** Translation key — also used as the collapse-store key. */
  labelKey: string;
  /** Where clicking the domain label navigates. */
  href: string;
  /** Module-visibility gate (passed to moduleVisible()). */
  moduleKey: string;
  /** Icon shown on the domain header button. */
  iconKey: NavIconKey;
  /**
   * Renders as a single link in the global sidebar — no chevron, no child rows, no
   * collapsed-sidebar flyout. The domain's `items` still describe its destinations; they
   * simply render somewhere else. Two consumers read them either way: the command menu, and
   * the domain's own in-page tab bar (`AdminShell`).
   *
   * Used by Administration, whose six screens are one workspace a person moves around inside,
   * not six unrelated destinations that happen to share a prefix. A tab bar says that; a
   * nested sidebar column says the opposite, and costs a column of width on every screen.
   */
  flat?: boolean;
  /** Flat, direct destinations — no sub-groups inside. */
  items: NavItem[];
}

// ─── Standalone (no domain) ───────────────────────────────────────────────────

export const STANDALONE_NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'dashboard', iconKey: 'grid' },
];

// ─── Domains ──────────────────────────────────────────────────────────────────

export const NAV_DOMAINS: NavDomain[] = [
  {
    labelKey: 'projects',
    href: '/projects',
    moduleKey: 'portfolio',
    iconKey: 'folder',
    items: [
      // Projects first: the module opens on Projects (/projects), Clients beside it.
      { href: '/projects', labelKey: 'projects', iconKey: 'briefcase' },
      { href: '/clients', labelKey: 'clients', iconKey: 'building' },
    ],
  },
  {
    // ADR-043 — "Two workspaces, one ledger": the finance team's workspace. Renamed from
    // Accounting; every route is unchanged (`/finance/accounting/*`, `/receipts`), only labels and
    // grouping moved. `moduleKey` stays `accounting` (the module-visibility gate, view:accounting).
    labelKey: 'finance',
    href: '/accounting',
    moduleKey: 'accounting',
    iconKey: 'chart-bar',
    // Ungrouped items lead the tab bar: Get started (the guided accounting hub, the module's landing
    // while setup is incomplete — a company-wide Finance overview does not exist yet) and Projects (the portfolio, gated like its API on
    // view:financial-position). Then the named sections; the groupKey draws the micro-label.
    items: [
      { href: '/finance/accounting/guide', labelKey: 'getStarted', iconKey: 'check-circle' },
      { href: '/finance/projects', labelKey: 'financeProjects', iconKey: 'briefcase', permissionKey: 'view:financial-position' },
      // Receivables
      { href: '/finance/accounting/invoices', labelKey: 'clientInvoices', iconKey: 'file-text', groupKey: 'receivables' },
      { href: '/receipts', labelKey: 'receipts', iconKey: 'receipt', groupKey: 'receivables' },
      // Payables
      { href: '/finance/accounting/bills', labelKey: 'supplierBills', iconKey: 'credit-card', groupKey: 'payables' },
      { href: '/finance/accounting/payments', labelKey: 'supplierPayments', iconKey: 'wallet', groupKey: 'payables' },
      // ADR-044 — finance's inbox of quotation requests waiting for a choice; counts the decide queue.
      { href: '/finance/quotes', labelKey: 'quotesToChoose', iconKey: 'check-circle', groupKey: 'payables', permissionKey: 'award:quotation', badge: 'quotesToChoose' },
      // Banking
      { href: '/finance/accounting/bank-accounts', labelKey: 'bankAccounts', iconKey: 'credit-card', groupKey: 'banking' },
      { href: '/finance/accounting/reconciliation', labelKey: 'reconciliation', iconKey: 'check-circle', groupKey: 'banking' },
      // General Ledger
      { href: '/finance/accounting/journals', labelKey: 'journals', iconKey: 'book-open', groupKey: 'ledger' },
      { href: '/finance/accounting/chart-of-accounts', labelKey: 'chartOfAccounts', iconKey: 'list', groupKey: 'ledger' },
      { href: '/finance/accounting/ledger', labelKey: 'accountLedger', iconKey: 'clipboard', groupKey: 'ledger' },
      // Reports
      { href: '/finance/accounting/trial-balance', labelKey: 'trialBalance', iconKey: 'trending-up', groupKey: 'reports' },
      { href: '/finance/accounting/balance-sheet', labelKey: 'balanceSheet', iconKey: 'trending-up', groupKey: 'reports' },
      { href: '/finance/accounting/profit-loss', labelKey: 'profitLoss', iconKey: 'trending-up', groupKey: 'reports' },
      { href: '/finance/accounting/monthly-comparison', labelKey: 'monthlyComparison', iconKey: 'trending-up', groupKey: 'reports' },
      // ADR-043 Phase 4 — a forward-looking report across projects, AR and AP; gated like its API.
      { href: '/finance/cashflow', labelKey: 'cashFlow', iconKey: 'trending-up', groupKey: 'reports', permissionKey: 'view:financial-position' },
      // Setup & close
      { href: '/finance/accounting/posting-profiles', labelKey: 'postingProfiles', iconKey: 'git-branch', groupKey: 'acctSetup' },
      { href: '/finance/accounting/tax', labelKey: 'taxCodes', iconKey: 'tag', groupKey: 'acctSetup' },
      { href: '/finance/accounting/invoice-settings', labelKey: 'invoiceSettings', iconKey: 'receipt', groupKey: 'acctSetup' },
      { href: '/finance/accounting/opening-balance', labelKey: 'openingBalance', iconKey: 'book-open', groupKey: 'acctSetup' },
      { href: '/finance/accounting/periods', labelKey: 'fiscalPeriods', iconKey: 'calendar', groupKey: 'acctSetup' },
    ],
  },
  {
    labelKey: 'procurement',
    href: '/procurement',
    moduleKey: 'procurement',
    iconKey: 'shopping-cart',
    // Tab order follows the purchasing flow: request → order → receive → bill → advance, then
    // the cost view, the supplier register and setup. Supplier bills is a cross-link into
    // Procurement — the route stays canonical under Accounting (its list, detail and create
    // pages and every link between them live there). Payments are NOT here; treasury stays in
    // Accounting. Master data groups under "Setup".
    items: [
      { href: '/procurement/requests', labelKey: 'materialRequests', iconKey: 'clipboard' },
      // ADR-044 — the field buyer's quotation photos, between an approved request and its order.
      { href: '/procurement/quotes', labelKey: 'quotes', iconKey: 'receipt', permissionKey: 'collect:quotation' },
      { href: '/procurement/orders', labelKey: 'purchaseOrders', iconKey: 'shopping-cart' },
      { href: '/procurement/grn', labelKey: 'goodsReceipts', iconKey: 'truck' },
      { href: '/finance/accounting/bills', labelKey: 'supplierBills', iconKey: 'credit-card', crossLink: true },
      { href: '/procurement/advances', labelKey: 'buyerAdvances', iconKey: 'wallet' },
      { href: '/procurement/commitments', labelKey: 'commitments', iconKey: 'chart-bar' },
      // Suppliers: ungated master data — buyers add suppliers as purchasing widens, so this
      // must not require manage:procurement-config (a buyer needs to add the supplier their
      // own PO needs). The four catalogue screens below are one-time configuration and keep
      // their manage:procurement-config gate.
      { href: '/procurement/suppliers', labelKey: 'suppliers', iconKey: 'storefront' },
      { href: '/procurement/setup/materials', labelKey: 'materials', iconKey: 'package', permissionKey: 'manage:procurement-config', groupKey: 'setup' },
      { href: '/procurement/setup/material-categories', labelKey: 'materialCategories', iconKey: 'tag', permissionKey: 'manage:procurement-config', groupKey: 'setup' },
      { href: '/procurement/setup/uom', labelKey: 'unitsOfMeasure', iconKey: 'ruler', permissionKey: 'manage:procurement-config', groupKey: 'setup' },
      { href: '/procurement/setup/spend-categories', labelKey: 'spendCategories', iconKey: 'credit-card', permissionKey: 'manage:procurement-config', groupKey: 'setup' },
    ],
  },
  {
    labelKey: 'administration',
    href: '/admin',
    moduleKey: 'administration',
    iconKey: 'shield',
    flat: true,
    // These six items no longer render in the sidebar. Clicking Administration opens the
    // Administration workspace, and they are its tab bar (`AdminShell`) — the same move the
    // project Finance workspace made. They stay declared here because this list is the single
    // source of truth for the routes, their labels, their icons and their permission gates,
    // read by the sidebar's active state, the command menu and the tab bar alike.
    //
    // The `groupKey`s survive the move but no longer draw anything. They record the four jobs
    // this workspace does — people, org data, approval governance, evidence — and they fix the
    // tab order, which is what the reader now perceives instead of the labels. Access reviews
    // and a standalone SoD registry remain DEFERRED (no backend) and deliberately absent: a
    // tab that 404s is worse than one documented in the design's deferred list.
    items: [
      { href: '/admin/users', labelKey: 'users', iconKey: 'users', groupKey: 'people' },
      { href: '/admin/roles', labelKey: 'roles', iconKey: 'user-gear', groupKey: 'people' },
      { href: '/admin/districts', labelKey: 'districts', iconKey: 'building', permissionKey: 'manage:district', groupKey: 'organization' },
      { href: '/admin/project-subtypes', labelKey: 'projectSubtypes', iconKey: 'tag', permissionKey: 'manage:project-type', groupKey: 'organization' },
      { href: '/admin/branding', labelKey: 'branding', iconKey: 'receipt', permissionKey: 'manage:organization', groupKey: 'organization' },
      { href: '/admin/workflows', labelKey: 'workflows', iconKey: 'git-branch', groupKey: 'governance' },
      { href: '/admin/audit-logs', labelKey: 'auditLogs', iconKey: 'key', groupKey: 'evidence' },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isActiveNavItem(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** One labelled sub-section of a domain's items, in declared order. */
export interface NavItemGroup {
  /** `undefined` for the ungrouped items that lead the list; otherwise a `groupKey`. */
  key: string | undefined;
  items: NavItem[];
}

/**
 * Splits a domain's items into the leading ungrouped run followed by each labelled group,
 * preserving declared order within and across groups. Ungrouped items always come first —
 * the operational spine reads before configuration is set aside under a label.
 *
 * The renderer walks this instead of the flat list so the grouping lives in one place and can
 * be asserted without a DOM.
 */
export function groupNavItems(items: NavItem[]): NavItemGroup[] {
  const groups: NavItemGroup[] = [];
  for (const item of items) {
    const key = item.groupKey;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, items: [item] });
    }
  }
  return groups;
}
