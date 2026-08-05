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

export interface NavGroup {
  /** Translation key in `platform.nav` for the group heading. */
  labelKey: string;
  /** Matches a key in `MODULE_PERMISSIONS` for permission gating. */
  moduleKey: string;
  items: NavItem[];
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
      { href: '/finance/general-ledger', labelKey: 'generalLedger', disabled: true },
    ],
  },
  {
    labelKey: 'operations',
    moduleKey: 'operations',
    items: [
      { href: '/operations/procurement', labelKey: 'procurement', disabled: true },
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
