/**
 * Domain navigation. Each domain is a major product area with its own
 * collapsible section and a stable entry route.
 *
 * Two levels only: Domain → direct destination. No sub-groups.
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
    items: [
      { href: '/procurement/suppliers', labelKey: 'suppliers', iconKey: 'storefront' },
      { href: '/procurement/requests', labelKey: 'materialRequests', iconKey: 'clipboard' },
      { href: '/procurement/orders', labelKey: 'purchaseOrders', iconKey: 'shopping-cart' },
      { href: '/procurement/grn', labelKey: 'goodsReceipts', iconKey: 'truck' },
      { href: '/procurement/commitments', labelKey: 'commitments', iconKey: 'chart-bar' },
      { href: '/procurement/setup/materials', labelKey: 'materials', iconKey: 'package', permissionKey: 'manage:procurement-config' },
      { href: '/procurement/setup/material-categories', labelKey: 'materialCategories', iconKey: 'tag', permissionKey: 'manage:procurement-config' },
      { href: '/procurement/setup/uom', labelKey: 'unitsOfMeasure', iconKey: 'ruler', permissionKey: 'manage:procurement-config' },
      { href: '/procurement/setup/spend-categories', labelKey: 'spendCategories', iconKey: 'credit-card', permissionKey: 'manage:procurement-config' },
    ],
  },
  {
    labelKey: 'administration',
    href: '/admin',
    moduleKey: 'administration',
    iconKey: 'shield',
    items: [
      { href: '/admin/users', labelKey: 'users', iconKey: 'users' },
      { href: '/admin/roles', labelKey: 'roles', iconKey: 'user-gear' },
      { href: '/admin/districts', labelKey: 'districts', iconKey: 'building', permissionKey: 'manage:district' },
      { href: '/admin/workflows', labelKey: 'workflows', iconKey: 'git-branch' },
      { href: '/admin/audit-logs', labelKey: 'auditLogs', iconKey: 'key' },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isActiveNavItem(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}
