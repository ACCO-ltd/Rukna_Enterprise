/**
 * Builds the flat list of command-menu entries from the nav map and the action registry,
 * permission-filtered exactly as the sidebar filters itself.
 *
 * Kept free of React and the DOM so the gating and filtering rules can be unit-tested
 * directly, the same seam `nav-items.test.ts` uses for the nav map.
 */

import {
  NAV_DOMAINS,
  STANDALONE_NAV,
  type NavDomain,
  type NavItem,
} from '@/components/layout/nav-groups';
import type { PermissionKey } from '@/features/auth/permissions/can';

import { COMMAND_ACTIONS, type CommandAction } from './command-actions';

export type CommandGroup = 'goTo' | 'action';

export interface CommandEntry {
  /** Unique within the built list; used as the React key and the active-descendant id. */
  id: string;
  group: CommandGroup;
  /** The resolved, user-visible label. */
  label: string;
  /** Domain context shown after the label, e.g. "Accounting" — undefined for standalone. */
  context?: string;
  href: string;
}

/** The permission seam, matching the shape of `usePermissions()`. */
export interface Gate {
  can: (permission: PermissionKey) => boolean;
  moduleVisible: (module: string) => boolean;
}

/** Translates a nav label key. Injected so this stays outside React. */
export type Translate = (key: string) => string;

function navItemVisible(item: NavItem, gate: Gate): boolean {
  if (item.disabled) return false;
  if (item.permissionKey && !gate.can(item.permissionKey as PermissionKey)) return false;
  return true;
}

function goToEntriesForDomain(domain: NavDomain, gate: Gate, t: Translate): CommandEntry[] {
  if (!gate.moduleVisible(domain.moduleKey)) return [];

  const context = t(`nav.${domain.labelKey}`);
  return domain.items.filter((item) => navItemVisible(item, gate)).map((item) => ({
    id: `goto:${domain.labelKey}:${item.href}`,
    group: 'goTo' as const,
    label: t(`nav.${item.labelKey}`),
    context,
    href: item.href,
  }));
}

function actionEntry(action: CommandAction, gate: Gate, t: Translate): CommandEntry | null {
  if (!gate.moduleVisible(action.moduleKey)) return null;
  if (action.permissionKey && !gate.can(action.permissionKey)) return null;
  return {
    id: `action:${action.id}`,
    group: 'action',
    label: t(`commandMenu.action.${action.id}`),
    href: action.href,
  };
}

/**
 * The full, permission-filtered entry list in display order: standalone destinations, then
 * every domain's destinations ("Go to"), then the create-actions ("Actions").
 */
export function buildCommandEntries(gate: Gate, t: Translate): CommandEntry[] {
  const goTo: CommandEntry[] = [];

  for (const item of STANDALONE_NAV) {
    if (!navItemVisible(item, gate)) continue;
    goTo.push({
      id: `goto:standalone:${item.href}`,
      group: 'goTo',
      label: t(`nav.${item.labelKey}`),
      href: item.href,
    });
  }

  for (const domain of NAV_DOMAINS) {
    goTo.push(...goToEntriesForDomain(domain, gate, t));
  }

  const actions = COMMAND_ACTIONS.map((a) => actionEntry(a, gate, t)).filter(
    (e): e is CommandEntry => e !== null,
  );

  return [...goTo, ...actions];
}

/** Case-insensitive substring match over label + context. Empty query matches everything. */
export function filterCommandEntries(entries: CommandEntry[], query: string): CommandEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => {
    const haystack = `${entry.label} ${entry.context ?? ''}`.toLowerCase();
    return haystack.includes(needle);
  });
}
