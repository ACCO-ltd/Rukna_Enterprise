/**
 * The module navigation model (ADR-035).
 *
 * The sidebar lists modules only. A module's pages are reached through its tab bar
 * (`ModuleTabs`) under the `ModuleHeader`. Both read `NAV_DOMAINS`, so there is still exactly
 * one declaration of every route, label and permission gate — this file only derives the two
 * shapes from it:
 *
 *   - which module a pathname belongs to (`resolveModule`), and
 *   - the module's tabs: an ungrouped item is a direct tab, and items sharing a `groupKey`
 *     become one dropdown tab (`moduleTabs`).
 *
 * Pure functions, no React, so both can be asserted without a DOM.
 */

import { isActiveNavItem, NAV_DOMAINS, type NavDomain, type NavItem } from './nav-groups';

export interface ModuleTabLink {
  kind: 'link';
  key: string;
  labelKey: string;
  href: string;
  active: boolean;
}

export interface ModuleTabMenu {
  kind: 'menu';
  key: string;
  /** `nav.group.<groupKey>` */
  labelKey: string;
  items: Array<{ href: string; labelKey: string; active: boolean }>;
  active: boolean;
}

export type ModuleTab = ModuleTabLink | ModuleTabMenu;

export interface ResolvedModule {
  domain: NavDomain;
  /** The owning (non cross-link) item for this pathname, if any. */
  item: NavItem | undefined;
  /** The group the item sits in — the middle breadcrumb. */
  groupKey: string | undefined;
}

/**
 * Paths that belong to a module but render their own workspace chrome, so the module header and
 * tabs must stand aside — one navigation system per page. The project workspace keeps its own
 * tabs until its migration is validated separately.
 */
function hasOwnWorkspace(pathname: string): boolean {
  return /^\/projects\/(?!new(?:\/|$))[^/]+/.test(pathname);
}

/**
 * The module a pathname belongs to, or null for a page outside every module (the dashboard, a
 * project workspace, notifications). Flat domains (Administration) keep their own workspace
 * shell and are not resolved here.
 *
 * Cross-links are ignored on purpose: Supplier bills is listed under Procurement for
 * discoverability, but the page belongs to Accounting and must show Accounting's header.
 */
export function resolveModule(pathname: string): ResolvedModule | null {
  if (hasOwnWorkspace(pathname)) return null;

  let best: { domain: NavDomain; item: NavItem } | null = null;
  for (const domain of NAV_DOMAINS) {
    if (domain.flat) continue;
    for (const item of domain.items) {
      if (item.crossLink) continue;
      if (!isActiveNavItem(pathname, item.href)) continue;
      // Longest href wins, so `/procurement/setup/uom` beats a shorter prefix.
      if (!best || item.href.length > best.item.href.length) best = { domain, item };
    }
  }
  if (best) return { domain: best.domain, item: best.item, groupKey: best.item.groupKey };

  // A module's own landing route (`/accounting`, `/procurement`) redirects, but can render for a
  // frame first; give it the module chrome rather than a bare page.
  const home = NAV_DOMAINS.find((d) => !d.flat && d.href === pathname);
  return home ? { domain: home, item: undefined, groupKey: undefined } : null;
}

type Can = (permission: `${string}:${string}`) => boolean;

function allowed(item: NavItem, can: Can): boolean {
  if (item.disabled) return false;
  return !item.permissionKey || can(item.permissionKey as `${string}:${string}`);
}

/**
 * The tab bar for a module. Items the user cannot access are removed, never disabled; a group
 * whose every item is gated away disappears with them. A group left holding a single item is
 * still a dropdown — the tab's label names the section, and its position must not jump around
 * between roles.
 */
export function moduleTabs(domain: NavDomain, pathname: string, can: Can): ModuleTab[] {
  const owner = resolveModule(pathname);
  const isActive = (item: NavItem) =>
    owner?.domain === domain && owner.item?.href === item.href;

  const tabs: ModuleTab[] = [];
  for (const item of domain.items) {
    if (!allowed(item, can)) continue;
    if (!item.groupKey) {
      tabs.push({
        kind: 'link',
        key: item.href,
        labelKey: item.labelKey,
        href: item.href,
        active: isActive(item),
      });
      continue;
    }
    let menu = tabs.find(
      (tab): tab is ModuleTabMenu => tab.kind === 'menu' && tab.key === item.groupKey,
    );
    if (!menu) {
      menu = { kind: 'menu', key: item.groupKey, labelKey: `group.${item.groupKey}`, items: [], active: false };
      tabs.push(menu);
    }
    const active = isActive(item);
    menu.items.push({ href: item.href, labelKey: item.labelKey, active });
    if (active) menu.active = true;
  }
  return tabs;
}
