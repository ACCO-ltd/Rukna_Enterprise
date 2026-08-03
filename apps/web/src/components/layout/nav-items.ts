/**
 * Primary navigation.
 *
 * Only destinations backed by live endpoints appear here. Procurement, Stock, Cost and
 * DPRs are on the roadmap but have no API, and `apps/web/CLAUDE.md` is explicit that UI
 * must not be built — or stubbed — ahead of them. A greyed-out "coming soon" item reads to
 * a stakeholder as nearly-finished work, which is worse than an honestly short menu.
 *
 * Clients, Contracts and Receipts DO have live endpoints as of Sprint 3 and join this list
 * as each surface ships. IPA and IPC are reached through their contract rather than the
 * top-level menu — an application detached from the contract it bills against is not a
 * destination anyone navigates to directly.
 *
 * `labelKey` resolves against the `platform.nav` namespace.
 */
export interface NavItem {
  href: string;
  labelKey: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', labelKey: 'dashboard' },
  { href: '/projects', labelKey: 'projects' },
  { href: '/clients', labelKey: 'clients' },
];

/** True when `pathname` is the nav destination itself or a page nested beneath it. */
export function isActiveNavItem(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
