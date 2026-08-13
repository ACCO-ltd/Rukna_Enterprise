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
  LifebuoyIcon,
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
        'relative flex h-[68px] shrink-0 items-center border-b border-border transition-[padding,gap] duration-300',
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

      {!sidebarCollapsed ? (
        <div className="mx-3 mb-3 rounded-xl border border-brand-primary/15 bg-brand-accent/55 p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-brand-primary shadow-sm ring-1 ring-border">
              <LifebuoyIcon size={20} weight="duotone" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-brand-ink">{t('shell.helpTitle')}</p>
              <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
                {t('shell.helpDescription')}
              </p>
            </div>
          </div>
        </div>
      ) : null}

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
          'flex min-h-10 items-center rounded-lg border border-transparent text-[13px] font-semibold transition-all duration-200',
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
          isActive
            ? 'border-brand-primary bg-brand-primary text-brand-on-primary shadow-[var(--shadow-control)]'
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
            ? 'bg-brand-accent font-semibold text-brand-primary shadow-[inset_0_0_0_1px_rgb(47_102_208/0.08)]'
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
  const useProfessionalIcons = true;
  if (useProfessionalIcons) {
    return <ProfessionalIcon size={17} weight="regular" aria-hidden="true" className={className} />;
  }

  const base = (children: React.ReactNode) => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );

  switch (iconKey) {
    case 'grid':
      return base(
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </>,
      );
    case 'building':
      return base(
        <>
          <path d="M3 21h18" />
          <path d="M5 21V5a1 1 0 011-1h12a1 1 0 011 1v16" />
          <path d="M9 21v-5h6v5" />
          <path d="M9 8h1M13 8h1M9 12h1M13 12h1" />
        </>,
      );
    case 'folder':
      return base(
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />,
      );
    case 'receipt':
      return base(
        <>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14,2 14,8 20,8" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="13" y2="17" />
        </>,
      );
    case 'cog':
      return base(
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </>,
      );
    case 'pencil':
      return base(
        <>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
        </>,
      );
    case 'chart-bar':
      return base(
        <>
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </>,
      );
    case 'users':
      return base(
        <>
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87" />
          <path d="M16 3.13a4 4 0 010 7.75" />
        </>,
      );
    case 'clipboard':
      return base(
        <>
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <line x1="9" y1="12" x2="15" y2="12" />
          <line x1="9" y1="16" x2="13" y2="16" />
        </>,
      );
    case 'shopping-cart':
      return base(
        <>
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 001.95 1.61h9.72a2 2 0 001.95-1.57l1.65-7.43H6" />
        </>,
      );
    case 'truck':
      return base(
        <>
          <rect x="1" y="3" width="15" height="13" />
          <polygon points="16,8 20,8 23,11 23,16 16,16 16,8" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </>,
      );
    case 'trending-up':
      return base(
        <>
          <polyline points="23,6 13.5,15.5 8.5,10.5 1,18" />
          <polyline points="17,6 23,6 23,12" />
        </>,
      );
    case 'shield':
      return base(
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
      );
    case 'git-branch':
      return base(
        <>
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 01-9 9" />
        </>,
      );
    case 'list':
      return base(
        <>
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </>,
      );
    default:
      return null;
  }
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
