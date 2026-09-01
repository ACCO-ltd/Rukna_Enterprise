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
  | 'key';

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
   * route stays `/finance/accounting/bills` under Accounting). Marks intent for readers; the
   * link resolves to the same single destination either way.
   */
  crossLink?: boolean;
  /** Retained for test helpers; hidden in production navigation. */
  disabled?: boolean;
}

export interface NavDomain {
  /** Translation key — also used as the collapse-store key. */
  labelKey: string;
  /** Where clicking the domain label navigates. */
  href: string;
  /** Module-visibility gate (passed to moduleVisible()). */
  moduleKey: string;
  /** Icon shown on the domain header button. */
  iconKey: NavIconKey;
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
      { href: '/clients', labelKey: 'clients', iconKey: 'building' },
      { href: '/projects', labelKey: 'projects', iconKey: 'briefcase' },
    ],
  },
  {
    labelKey: 'accounting',
    href: '/accounting',
    moduleKey: 'accounting',
    iconKey: 'chart-bar',
    items: [
      { href: '/finance/accounting/chart-of-accounts', labelKey: 'chartOfAccounts', iconKey: 'list' },
      { href: '/finance/accounting/journals', labelKey: 'journals', iconKey: 'book-open' },
      { href: '/finance/accounting/invoices', labelKey: 'clientInvoices', iconKey: 'file-text' },
      { href: '/receipts', labelKey: 'receipts', iconKey: 'receipt' },
      { href: '/finance/accounting/bills', labelKey: 'supplierBills', iconKey: 'credit-card' },
      { href: '/finance/accounting/payments', labelKey: 'supplierPayments', iconKey: 'wallet' },
      { href: '/finance/accounting/ledger', labelKey: 'generalLedger', iconKey: 'clipboard' },
      { href: '/accounting/reports', labelKey: 'accountingReports', iconKey: 'trending-up' },
      { href: '/finance/accounting/periods', labelKey: 'fiscalPeriods', iconKey: 'calendar' },
    ],
  },
  {
    labelKey: 'procurement',
    href: '/procurement',
    moduleKey: 'procurement',
    iconKey: 'shopping-cart',
    // Round-2 spine (decision A4): the purchase order is the primary entry, with material
    // requests demoted below it to an optional "needs list". Supplier bills is a cross-link
    // into Procurement — the route stays canonical under Accounting. Payments are NOT here;
    // treasury stays in Accounting. Master data groups under "Setup".
    items: [
      { href: '/procurement/orders', labelKey: 'purchaseOrders', iconKey: 'shopping-cart' },
      { href: '/procurement/requests', labelKey: 'materialRequests', iconKey: 'clipboard' },
      { href: '/procurement/grn', labelKey: 'goodsReceipts', iconKey: 'truck' },
      { href: '/finance/accounting/bills', labelKey: 'supplierBills', iconKey: 'credit-card', crossLink: true },
      { href: '/procurement/commitments', labelKey: 'commitments', iconKey: 'chart-bar' },
      // Setup — one-time configuration. Suppliers is master data added as purchasing widens,
      // so it stays ungated (a buyer must be able to add the supplier their own PO needs); the
      // four catalogue screens keep their manage:procurement-config gate.
      { href: '/procurement/suppliers', labelKey: 'suppliers', iconKey: 'storefront', groupKey: 'setup' },
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
    // The flat admin column mixed four different jobs — people, org data, approval
    // governance, and evidence. They are grouped with the same `groupKey` mechanism
    // Procurement's "Setup" uses: quiet micro-label dividers, not a second collapsible
    // level. Every admin item carries a group so no ungrouped run leads (the sections
    // read People → Organization → Approval governance → Evidence). Access reviews and a
    // standalone SoD registry are DEFERRED (no backend) and deliberately absent — an item
    // that 404s is worse than one documented in the design's deferred list.
    items: [
      { href: '/admin/users', labelKey: 'users', iconKey: 'users', groupKey: 'people' },
      { href: '/admin/roles', labelKey: 'roles', iconKey: 'user-gear', groupKey: 'people' },
      { href: '/admin/districts', labelKey: 'districts', iconKey: 'building', permissionKey: 'manage:district', groupKey: 'organization' },
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
