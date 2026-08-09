'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';

import { usePermissions } from '@/features/auth/permissions/can';
import { useSession } from '@/features/auth/session/use-session';

import {
  isActiveNavItem,
  NAV_GROUPS,
  STANDALONE_NAV,
  type NavItem,
  type NavSubGroup,
} from './nav-groups';
import { navCollapseStore } from './nav-collapse-store';

interface GlobalSidebarProps {
  onNavigate?: () => void;
}

export function GlobalSidebar({ onNavigate }: GlobalSidebarProps) {
  const t = useTranslations('platform');
  const pathname = usePathname();
  const { can, moduleVisible } = usePermissions();
  const { user } = useSession();

  const collapsed = useSyncExternalStore(
    navCollapseStore.subscribe,
    navCollapseStore.getSnapshot,
    navCollapseStore.getServerSnapshot,
  );

  /**
   * A sub-group the user has never touched falls back to its own `defaultCollapsed`, and
   * one containing the current page is always open — landing on
   * `/procurement/setup/uom` with Setup shut would hide the active item.
   *
   * "Never touched" is `defaultCollapsed && not in the list`, so a Setup group the user
   * deliberately opened stays open: opening it adds nothing, but it is the *absence* of a
   * stored preference that makes the default apply, and toggling writes one either way.
   */
  const isCollapsed = (group: NavSubGroup): boolean => {
    if (group.items.some((item) => isActiveNavItem(pathname, item.href))) return false;
    if (collapsed.includes(group.labelKey)) return true;
    return (group.defaultCollapsed ?? false) && !collapsed.includes(`${group.labelKey}:open`);
  };

  /**
   * Toggling a default-collapsed group has to record "opened" explicitly, because for
   * those groups an empty list already means collapsed.
   */
  const toggleSubGroup = (group: NavSubGroup): void => {
    if (group.defaultCollapsed) {
      navCollapseStore.toggle(`${group.labelKey}:open`);
      return;
    }
    navCollapseStore.toggle(group.labelKey);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Brand + org */}
      <div className="flex h-16 shrink-0 flex-col justify-center border-b border-slate-800 px-5">
        <span className="text-[13px] font-bold tracking-tight text-white">Rukna ERP</span>
        {user ? (
          <span className="mt-0.5 truncate text-[11px] uppercase tracking-widest text-slate-500">
            {user.tenantSlug}
          </span>
        ) : null}
      </div>

      <nav
        aria-label={t('shell.primaryNavLabel')}
        className="flex-1 space-y-5 px-3 py-4"
      >
        {/* Standalone items — Dashboard */}
        <ul className="space-y-0.5">
          {STANDALONE_NAV.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              t={t}
              onNavigate={onNavigate}
            />
          ))}
        </ul>

        {/* Grouped sections */}
        {NAV_GROUPS.map((group) => {
          if (!moduleVisible(group.moduleKey)) return null;

          return (
            <div key={group.labelKey}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                {t(`nav.${group.labelKey}`)}
              </p>

              {group.subGroups?.map((subGroup) => {
                if (subGroup.permissionKey && !can(subGroup.permissionKey as `${string}:${string}`)) {
                  return null;
                }

                const shut = isCollapsed(subGroup);
                const panelId = `nav-subgroup-${subGroup.labelKey}`;

                return (
                  <div key={subGroup.labelKey} className="mb-0.5">
                    <button
                      type="button"
                      onClick={() => toggleSubGroup(subGroup)}
                      aria-expanded={!shut}
                      aria-controls={panelId}
                      className="flex min-h-9 w-full items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'inline-block text-[9px] transition-transform rtl:-scale-x-100',
                          shut ? '' : 'rotate-90',
                        )}
                      >
                        ▶
                      </span>
                      {t(`nav.${subGroup.labelKey}`)}
                    </button>

                    {shut ? null : (
                      <ul id={panelId} className="mt-0.5 space-y-0.5 ps-3">
                        {subGroup.items.map((item) => (
                          <NavLink
                            key={item.href}
                            item={item}
                            pathname={pathname}
                            t={t}
                            onNavigate={onNavigate}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}

              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    t={t}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </div>
  );
}

// ─── Nav link atom ────────────────────────────────────────────────────────────

interface NavLinkProps {
  item: NavItem;
  pathname: string;
  t: ReturnType<typeof useTranslations>;
  onNavigate?: () => void;
}

function NavLink({ item, pathname, t, onNavigate }: NavLinkProps) {
  const isActive = isActiveNavItem(pathname, item.href);
  const label = t(`nav.${item.labelKey}`);

  if (item.disabled) {
    return (
      <li>
        <span
          className={cn(
            'flex min-h-9 cursor-not-allowed items-center gap-2 rounded-md px-2 text-[13px] font-medium',
            'text-slate-500',
          )}
          aria-disabled="true"
          title={t('nav.comingSoon')}
        >
          {label}
          <span className="ms-auto shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 ring-1 ring-inset ring-slate-600">
            {t('nav.soon')}
          </span>
        </span>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex min-h-9 items-center rounded-md px-2 text-[13px] font-medium transition-colors',
          isActive
            ? 'bg-brand-primary-hover text-white'
            : 'text-slate-300 hover:bg-slate-800 hover:text-white',
        )}
      >
        {label}
      </Link>
    </li>
  );
}
