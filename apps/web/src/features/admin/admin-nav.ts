import { NAV_DOMAINS, type NavItem } from '@/components/layout/nav-groups';

/**
 * The Administration workspace's tabs.
 *
 * Derived from the nav model rather than re-declared, so a route, a label, an icon or a
 * permission gate is written once and the sidebar's active state, the command menu and this
 * tab bar cannot drift apart. Declared order is tab order.
 */
export const ADMIN_TABS: NavItem[] =
  NAV_DOMAINS.find((domain) => domain.moduleKey === 'administration')?.items ?? [];

/**
 * True for a route that sits *beneath* a tab rather than on one — today only the governance
 * builder at `/admin/workflows/[policyId]`.
 *
 * Those routes are workspaces in their own right, with their own header and their own tab bar,
 * so the Administration chrome has to get out of the way: two stacked tab bars is not a
 * hierarchy a reader can parse. Written against the tab list rather than against
 * `/admin/workflows` by name, so the next deep route inherits the behaviour instead of
 * rediscovering the bug.
 */
export function isAdminDeepRoute(pathname: string): boolean {
  return ADMIN_TABS.some((tab) => pathname.startsWith(`${tab.href}/`));
}

/** The tabs this user may see. Gates are the item's own — there is no second list to keep. */
export function visibleAdminTabs(can: (permission: `${string}:${string}`) => boolean): NavItem[] {
  return ADMIN_TABS.filter(
    (tab) => !tab.permissionKey || can(tab.permissionKey as `${string}:${string}`),
  );
}
