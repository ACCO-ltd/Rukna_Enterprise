'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';
import {
  BookOpenIcon,
  BriefcaseIcon,
  BuildingsIcon,
  CalendarBlankIcon,
  CaretRightIcon,
  ChartBarIcon,
  ClipboardTextIcon,
  CreditCardIcon,
  FileTextIcon,
  FolderOpenIcon,
  GearIcon,
  GitBranchIcon,
  KeyIcon,
  ListBulletsIcon,
  PackageIcon,
  PencilSimpleIcon,
  ReceiptIcon,
  RulerIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  SquaresFourIcon,
  StorefrontIcon,
  TagIcon,
  TrendUpIcon,
  TruckIcon,
  UserGearIcon,
  UsersThreeIcon,
  WalletIcon,
  type Icon,
} from '@phosphor-icons/react';

import { usePermissions } from '@/features/auth/permissions/can';
import { useSession } from '@/features/auth/session/use-session';

import {
  isActiveNavItem,
  NAV_DOMAINS,
  STANDALONE_NAV,
  type NavDomain,
  type NavIconKey,
  type NavItem,
} from './nav-groups';
import { navCollapseStore } from './nav-collapse-store';
import { sidebarCollapseStore } from './sidebar-collapse-store';

interface GlobalSidebarProps {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

function toInitials(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.replace(/[._-]+/g, ' ').trim().split(/\s+/);
  return parts.length >= 2
    ? ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
    : local.slice(0, 2).toUpperCase();
}

export function GlobalSidebar({
  onNavigate,
  collapsed: controlledCollapsed,
  onToggleCollapsed,
}: GlobalSidebarProps) {
  const t = useTranslations('platform');
  const pathname = usePathname();
  const { can, moduleVisible } = usePermissions();
  const { user } = useSession();
  const localCollapsed = useSyncExternalStore(
    sidebarCollapseStore.subscribe,
    sidebarCollapseStore.getSnapshot,
    sidebarCollapseStore.getServerSnapshot,
  );
  const sidebarCollapsed = controlledCollapsed ?? localCollapsed;

  const toggleSidebar = () => {
    if (onToggleCollapsed) {
      onToggleCollapsed();
      return;
    }
    sidebarCollapseStore.toggle();
  };

  const collapsed = useSyncExternalStore(
    navCollapseStore.subscribe,
    navCollapseStore.getSnapshot,
    navCollapseStore.getServerSnapshot,
  );

  const isDomainActive = (domain: NavDomain): boolean =>
    domain.items.some((item) => isActiveNavItem(pathname, item.href));

  /** Domain stays expanded when any of its items is the current page. */
  const isDomainCollapsed = (domain: NavDomain): boolean => {
    if (isDomainActive(domain)) return false;
    return collapsed.includes(domain.labelKey);
  };

  const toggleDomain = (domain: NavDomain): void => {
    navCollapseStore.toggle(domain.labelKey);
  };

  return (
    <div className="flex h-full flex-col bg-surface text-foreground">

      {/* ── Brand header ──────────────────────────────────────────────── */}
      <div className={cn(
        'relative flex h-14 shrink-0 items-center border-b border-border transition-[padding,gap] duration-300',
        sidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-4',
      )}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-primary text-brand-on-primary shadow-[var(--shadow-control)]">
          <LogoMark />
        </div>
        <div className={cn(
          'min-w-0 overflow-hidden transition-[width,opacity] duration-200',
          sidebarCollapsed ? 'w-0 opacity-0' : 'w-32 opacity-100',
        )}>
          <span className="block text-[15px] font-bold text-brand-ink">
            Rukna ERP
          </span>
          {user ? (
            <span className="block truncate text-[10px] font-semibold uppercase text-brand-primary/70">
              {user.tenantSlug}
            </span>
          ) : null}
        </div>
        {!onNavigate ? (
          <button
            type="button"
            onClick={toggleSidebar}
            className={cn(
              'ms-auto hidden h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground shadow-sm transition hover:border-brand-primary/30 hover:bg-brand-accent hover:text-brand-primary lg:flex',
              sidebarCollapsed && 'absolute start-[3.9rem] ms-0 shadow-lg',
            )}
            aria-label={sidebarCollapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
          >
            <ChevronIcon className={cn('transition-transform duration-300 rtl:rotate-180', sidebarCollapsed && 'rotate-180 rtl:rotate-0')} />
          </button>
        ) : null}
      </div>

      {/* ── Primary nav ───────────────────────────────────────────────── */}
      <nav
        aria-label={t('shell.primaryNavLabel')}
        className={cn(
          'flex-1 px-2 py-3',
          sidebarCollapsed
            ? 'overflow-visible'
            : 'overflow-y-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]',
        )}
      >
        {/* Dashboard — standalone */}
        <div className="mb-2 px-1">
          <ul>
            {STANDALONE_NAV.map((item) => (
              <StandaloneLink
                key={item.href}
                item={item}
                pathname={pathname}
                t={t}
                onNavigate={onNavigate}
                collapsed={sidebarCollapsed}
              />
            ))}
          </ul>
        </div>

        {/* Domains */}
        <div className="space-y-0.5">
          {NAV_DOMAINS.map((domain) => {
            if (!moduleVisible(domain.moduleKey)) return null;

            const active = isDomainActive(domain);
            const shut = isDomainCollapsed(domain);
            const panelId = `nav-domain-${domain.labelKey}`;

            return (
              <div key={domain.labelKey} className="group/domain relative">
                {/* Domain header row */}
                <div
                  className={cn(
                    'mx-1 mb-0.5 flex items-center rounded-lg border border-transparent transition-colors',
                    active && 'border-brand-primary/10 bg-brand-accent/60',
                    sidebarCollapsed && active && 'border-brand-primary/15 bg-brand-accent',
                  )}
                >
                  {/* Label — navigates to domain home */}
                  <Link
                    href={domain.href}
                    onClick={onNavigate}
                    title={sidebarCollapsed ? t(`nav.${domain.labelKey}`) : undefined}
                    className={cn(
                      'flex min-h-10 flex-1 items-center rounded-md text-[13px] font-semibold transition-all duration-200',
                      sidebarCollapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
                      active
                        ? 'text-brand-primary'
                        : 'text-brand-ink/82 hover:bg-muted/70 hover:text-brand-ink',
                    )}
                  >
                    <NavIcon iconKey={domain.iconKey} className={cn('shrink-0', active ? 'opacity-100' : 'opacity-70')} />
                    <span className={cn('truncate', sidebarCollapsed && 'sr-only')}>
                      {t(`nav.${domain.labelKey}`)}
                    </span>
                  </Link>

                  {/* Chevron — toggles expand/collapse only */}
                  <button
                    type="button"
                    onClick={() => toggleDomain(domain)}
                    aria-expanded={!shut}
                    aria-controls={panelId}
                    aria-label={shut
                      ? t('shell.expandSection', { section: t(`nav.${domain.labelKey}`) })
                      : t('shell.collapseSection', { section: t(`nav.${domain.labelKey}`) })}
                    className={cn(
                      'flex h-10 w-9 shrink-0 items-center justify-center rounded-e-md transition-colors duration-150',
                      sidebarCollapsed && 'hidden',
                      active
                        ? 'text-brand-primary/70 hover:bg-brand-accent hover:text-brand-primary'
                        : 'text-muted-foreground/70 hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <ChevronIcon
                      className={cn(
                        'transition-transform duration-200 rtl:rotate-180',
                        !shut && 'rotate-90 rtl:rotate-90',
                      )}
                    />
                  </button>
                </div>

                {sidebarCollapsed ? (
                  <div className="pointer-events-none absolute start-[calc(100%-0.25rem)] top-0 z-50 w-64 translate-x-1 opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover/domain:pointer-events-auto group-hover/domain:translate-x-0 group-hover/domain:opacity-100 group-focus-within/domain:pointer-events-auto group-focus-within/domain:translate-x-0 group-focus-within/domain:opacity-100 rtl:-translate-x-1 rtl:group-hover/domain:translate-x-0 rtl:group-focus-within/domain:translate-x-0">
                    <div className="ms-3 overflow-hidden rounded-lg border border-border bg-surface-elevated p-2 shadow-[var(--shadow-overlay)]">
                      <Link
                        href={domain.href}
                        onClick={onNavigate}
                        className="mb-1 flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-semibold text-brand-ink hover:bg-muted"
                      >
                        <NavIcon iconKey={domain.iconKey} className="text-brand-primary" />
                        {t(`nav.${domain.labelKey}`)}
                      </Link>
                      <div className="my-1 h-px bg-border" />
                      <ul className="space-y-0.5">
                        {domain.items.map((item) => {
                          if (item.permissionKey && !can(item.permissionKey as `${string}:${string}`)) {
                            return null;
                          }
                          return (
                            <NavLink
                              key={item.href}
                              item={item}
                              pathname={pathname}
                              t={t}
                              onNavigate={onNavigate}
                              flyout
                            />
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                ) : null}

                <div className={cn(
                  'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
                  shut || sidebarCollapsed
                    ? 'grid-rows-[0fr] opacity-0'
                    : 'grid-rows-[1fr] opacity-100',
                )}>
                  <ul id={panelId} className="relative mb-2 min-h-0 overflow-hidden space-y-0.5 ps-8 pe-1 before:absolute before:bottom-3 before:start-[1.15rem] before:top-0 before:w-px before:bg-border-strong/70">
                    {domain.items.map((item) => {
                      if (
                        item.permissionKey &&
                        !can(item.permissionKey as `${string}:${string}`)
                      ) {
                        return null;
                      }
                      return (
                        <NavLink
                          key={item.href}
                          item={item}
                          pathname={pathname}
                          t={t}
                          onNavigate={onNavigate}
                        />
                      );
                    })}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </nav>

      {/* ── User footer ───────────────────────────────────────────────── */}
      {user ? (
        <div className={cn(
          'shrink-0 border-t border-border py-3 transition-[padding] duration-300',
          sidebarCollapsed ? 'px-2' : 'px-4',
        )}>
          <div className={cn('flex items-center', sidebarCollapsed ? 'justify-center' : 'gap-2.5')}>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-primary text-[11px] font-semibold text-brand-on-primary">
              {toInitials(user.email)}
            </div>
            <div className={cn(
              'min-w-0 overflow-hidden transition-[width,opacity] duration-200',
              sidebarCollapsed ? 'w-0 opacity-0' : 'w-44 opacity-100',
            )}>
              <p className="truncate text-[12px] font-semibold text-brand-ink">{user.email}</p>
              <p className="truncate text-[10px] uppercase text-muted-foreground">
                {user.tenantSlug}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Standalone link (Dashboard) ──────────────────────────────────────────────

interface StandaloneLinkProps {
  item: NavItem;
  pathname: string;
  t: ReturnType<typeof useTranslations>;
  onNavigate?: () => void;
  collapsed?: boolean;
}

function StandaloneLink({ item, pathname, t, onNavigate, collapsed }: StandaloneLinkProps) {
  const isActive = isActiveNavItem(pathname, item.href);
  return (
    <li className="group/standalone relative">
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={isActive ? 'page' : undefined}
        title={collapsed ? t(`nav.${item.labelKey}`) : undefined}
        className={cn(
          'relative flex min-h-10 items-center rounded-lg text-[13px] font-semibold transition-all duration-200',
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
          isActive
            ? 'bg-brand-accent font-semibold text-brand-primary before:absolute before:inset-y-1.5 before:-start-px before:w-0.5 before:rounded-full before:bg-brand-primary'
            : 'text-brand-ink/82 hover:bg-muted/70 hover:text-brand-ink',
        )}
      >
        {item.iconKey ? (
          <NavIcon
            iconKey={item.iconKey}
            className={cn('shrink-0', isActive ? 'opacity-100' : 'opacity-70')}
          />
        ) : null}
        <span className={cn('truncate', collapsed && 'sr-only')}>{t(`nav.${item.labelKey}`)}</span>
      </Link>
      {collapsed ? (
        <span className="pointer-events-none absolute start-[calc(100%+0.75rem)] top-1/2 z-50 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-semibold text-background opacity-0 shadow-[var(--shadow-overlay)] transition-[opacity,transform] duration-150 group-hover/standalone:translate-x-0 group-hover/standalone:opacity-100 group-focus-within/standalone:translate-x-0 group-focus-within/standalone:opacity-100 rtl:-translate-x-1 rtl:group-hover/standalone:translate-x-0 rtl:group-focus-within/standalone:translate-x-0">
          {t(`nav.${item.labelKey}`)}
        </span>
      ) : null}
    </li>
  );
}

// ─── Domain nav link ──────────────────────────────────────────────────────────

interface NavLinkProps {
  item: NavItem;
  pathname: string;
  t: ReturnType<typeof useTranslations>;
  onNavigate?: () => void;
  flyout?: boolean;
}

function NavLink({ item, pathname, t, onNavigate, flyout = false }: NavLinkProps) {
  const isActive = isActiveNavItem(pathname, item.href);
  const label = t(`nav.${item.labelKey}`);

  if (item.disabled) {
    return (
      <li>
        <span
          className="flex min-h-9 cursor-not-allowed items-center gap-2 rounded-lg px-2.5 text-[12.5px] text-muted-foreground/60"
          aria-disabled="true"
          title={t('nav.comingSoon')}
        >
          {label}
          <span className="ms-auto shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground ring-1 ring-inset ring-border-strong">
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
          'relative flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-[12.5px] transition-[background-color,color,box-shadow] duration-150 before:absolute before:-start-[0.85rem] before:top-1/2 before:h-px before:w-[0.85rem] before:bg-border-strong/70',
          flyout && 'before:hidden',
          isActive
            ? 'bg-brand-accent font-semibold text-brand-primary after:absolute after:inset-y-1.5 after:-start-px after:w-0.5 after:rounded-full after:bg-brand-primary'
            : 'font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground',
        )}
      >
        {item.iconKey ? (
          <NavIcon iconKey={item.iconKey} className={cn('shrink-0', isActive ? 'opacity-100' : 'opacity-70')} />
        ) : null}
        {label}
      </Link>
    </li>
  );
}

// ─── Icon set ─────────────────────────────────────────────────────────────────

function ChevronIcon({ className }: { className?: string }) {
  return <CaretRightIcon size={14} weight="bold" aria-hidden="true" className={className} />;
}

function NavIcon({ iconKey, className }: { iconKey: NavIconKey; className?: string }) {
  const icons: Record<NavIconKey, Icon> = {
    grid: SquaresFourIcon,
    building: BuildingsIcon,
    folder: FolderOpenIcon,
    receipt: ReceiptIcon,
    cog: GearIcon,
    pencil: PencilSimpleIcon,
    'chart-bar': ChartBarIcon,
    users: UsersThreeIcon,
    clipboard: ClipboardTextIcon,
    'shopping-cart': ShoppingCartIcon,
    truck: TruckIcon,
    'trending-up': TrendUpIcon,
    shield: ShieldCheckIcon,
    'git-branch': GitBranchIcon,
    list: ListBulletsIcon,
    briefcase: BriefcaseIcon,
    'file-text': FileTextIcon,
    'book-open': BookOpenIcon,
    'credit-card': CreditCardIcon,
    wallet: WalletIcon,
    calendar: CalendarBlankIcon,
    storefront: StorefrontIcon,
    package: PackageIcon,
    ruler: RulerIcon,
    tag: TagIcon,
    'user-gear': UserGearIcon,
    key: KeyIcon,
  };
  const ProfessionalIcon = icons[iconKey];
  return <ProfessionalIcon size={17} weight="regular" aria-hidden="true" className={className} />;
}

// ─── Logo mark ────────────────────────────────────────────────────────────────

function LogoMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}
