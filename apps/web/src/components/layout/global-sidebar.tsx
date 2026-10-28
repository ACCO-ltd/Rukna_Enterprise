'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';
import { ChevronLeft, Layers } from 'lucide-react';

import { usePermissions } from '@/features/auth/permissions/can';
import { useSession } from '@/features/auth/session/use-session';

import { useApprovalsInbox } from '@/features/approvals/hooks';

import { isActiveNavItem, NAV_DOMAINS, STANDALONE_NAV, type NavBadgeKey, type NavDomain, type NavIconKey } from './nav-groups';
import { NavCount } from './nav-badges';
import { NavIcon } from './nav-icon';
import { sidebarCollapseStore } from './sidebar-collapse-store';

interface GlobalSidebarProps {
  /**
   * `docked` — the fixed column: an icon rail between `md` and `lg`, a labelled column from
   * `lg` (unless the user has collapsed it). `drawer` — the phone menu: always labelled.
   */
  variant?: 'docked' | 'drawer';
  /** Called after a link is followed — the drawer closes itself with it. */
  onNavigate?: () => void;
}

/**
 * The global sidebar lists modules and nothing else (ADR-035).
 *
 * A module's pages live in its own tab bar under the module header, so the sidebar no longer
 * carries a second level — no expanding sections, no flyouts. One row per module, lit for
 * every route beneath it, is the whole job; there is exactly one navigation system per page.
 */
export function GlobalSidebar({ variant = 'docked', onNavigate }: GlobalSidebarProps) {
  const t = useTranslations('platform');
  const pathname = usePathname();
  const { moduleVisible } = usePermissions();
  const { user } = useSession();
  const userCollapsed = useSyncExternalStore(
    sidebarCollapseStore.subscribe,
    sidebarCollapseStore.getSnapshot,
    sidebarCollapseStore.getServerSnapshot,
  );

  const docked = variant === 'docked';
  // Labels show in the drawer always; docked, only from `lg` and only when not collapsed.
  const labelClass = docked ? (userCollapsed ? 'sr-only' : 'sr-only lg:not-sr-only') : undefined;
  const railClass = docked ? (userCollapsed ? 'justify-center px-0' : 'justify-center px-0 lg:justify-start lg:px-3') : 'px-3';

  const domainActive = (domain: NavDomain) =>
    isActiveNavItem(pathname, domain.href) ||
    domain.items.some((item) => !item.crossLink && isActiveNavItem(pathname, item.href));

  // The Approvals count follows the reader everywhere (ADR-049); the page shares this query.
  const approvals = useApprovalsInbox({ enabled: Boolean(user) });
  const counts: Partial<Record<NavBadgeKey, number | undefined>> = { approvals: approvals.data?.count };

  const rows: Array<{ href: string; labelKey: string; iconKey: NavIconKey; active: boolean; badge?: NavBadgeKey }> = [
    ...STANDALONE_NAV.map((item) => ({
      href: item.href,
      labelKey: item.labelKey,
      iconKey: item.iconKey ?? 'grid',
      active: isActiveNavItem(pathname, item.href),
      badge: item.badge,
    })),
    ...NAV_DOMAINS.filter((domain) => moduleVisible(domain.moduleKey)).map((domain) => ({
      href: domain.href,
      labelKey: domain.labelKey,
      iconKey: domain.iconKey,
      active: domainActive(domain),
    })),
  ];

  return (
    <div className="flex h-full flex-col bg-brand-panel text-nav-foreground">
      {/* ── Brand ─────────────────────────────────────────────────────── */}
      <div className={cn('flex h-14 shrink-0 items-center gap-3 border-b border-nav-border', railClass)}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-brand-primary text-brand-on-primary">
          <Layers size={16} aria-hidden="true" />
        </span>
        <span className={cn('min-w-0', labelClass)}>
          <span className="block text-body-sm font-semibold text-nav-foreground-active">Rukna ERP</span>
          {user ? (
            <span className="block truncate text-micro uppercase tracking-wider text-nav-foreground">
              {user.tenantSlug}
            </span>
          ) : null}
        </span>
      </div>

      {/* ── Modules ───────────────────────────────────────────────────── */}
      <nav
        aria-label={t('shell.primaryNavLabel')}
        // Docked, the rail's tooltips sit outside the column; a scroll container would clip them.
        className={cn('flex-1 px-2 py-3', docked ? 'overflow-visible' : 'overflow-y-auto')}
      >
        <ul className="space-y-1">
          {rows.map((row) => {
            const label = t(`nav.${row.labelKey}`);
            return (
              <li key={row.href} className="group/row relative">
                <Link
                  href={row.href}
                  onClick={onNavigate}
                  aria-current={row.active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-control text-body-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-nav-accent',
                    railClass,
                    row.active
                      ? 'bg-nav-active text-nav-foreground-active'
                      : 'text-nav-foreground hover:bg-nav-hover hover:text-nav-foreground-active',
                  )}
                >
                  <span className="relative shrink-0">
                    <NavIcon iconKey={row.iconKey} className={cn(row.active && 'text-nav-accent')} />
                    {/* On the icon rail the count shrinks to a dot on the icon. */}
                    {row.badge && counts[row.badge] && docked ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute -end-1 -top-1 size-2 rounded-full bg-nav-accent',
                          !userCollapsed && 'lg:hidden',
                        )}
                      />
                    ) : null}
                  </span>
                  <span className={cn('truncate', labelClass)}>{label}</span>
                  {row.badge ? (
                    <NavCount
                      badge={row.badge}
                      count={counts[row.badge]}
                      className={cn('ms-auto', docked && (userCollapsed ? 'sr-only' : 'sr-only lg:not-sr-only'))}
                    />
                  ) : null}
                </Link>
                {/* Rail tooltip — the label the rail hides, on hover and keyboard focus. */}
                {docked ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none absolute start-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-control bg-foreground px-2 py-1 text-caption font-medium text-background opacity-0 shadow-e3 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100',
                      !userCollapsed && 'lg:hidden',
                    )}
                  >
                    {label}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── Collapse (docked, lg+) ────────────────────────────────────── */}
      {docked ? (
        <div className="hidden shrink-0 border-t border-nav-border p-2 lg:block">
          <button
            type="button"
            onClick={() => sidebarCollapseStore.toggle()}
            className={cn(
              'flex min-h-10 w-full items-center gap-3 rounded-control text-body-sm text-nav-foreground transition-colors hover:bg-nav-hover hover:text-nav-foreground-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-nav-accent',
              userCollapsed ? 'justify-center' : 'px-3',
            )}
            aria-label={userCollapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
          >
            <ChevronLeft
              size={16}
              aria-hidden="true"
              className={cn('transition-transform', userCollapsed && 'rotate-180')}
            />
            {userCollapsed ? null : <span>{t('shell.collapseSidebar')}</span>}
          </button>
        </div>
      ) : null}
    </div>
  );
}
