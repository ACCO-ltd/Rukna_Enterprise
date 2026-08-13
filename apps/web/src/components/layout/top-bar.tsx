'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';

import { setThemePreference, useResolvedTheme } from '@/features/theme/theme-store';

import { UserMenu } from './user-menu';

interface TopBarProps {
  /** Opens the mobile global-nav drawer. */
  onOpenMenu: () => void;
}

/**
 * Sticky top application bar.
 *
 * Contains, left to right:
 *  - Mobile hamburger trigger
 *  - Global search (placeholder — no backend endpoint yet)
 *  - Attention indicator (placeholder — no GET /attention-items yet)
 *  - User avatar menu
 *
 * When a project workspace is active the breadcrumbs and page title live
 * in the `PageHeader` component below this bar, not in the bar itself.
 * This bar is intentionally content-agnostic to stay usable at every nesting level.
 */
export function TopBar({ onOpenMenu }: TopBarProps) {
  const t = useTranslations('platform.shell');

  return (
    <header className="sticky top-0 z-30 flex h-[68px] items-center gap-3 border-b border-border bg-surface px-3 shadow-[var(--shadow-control)] sm:px-5 lg:px-8">
      {/* Mobile menu trigger */}
      <button
        type="button"
        onClick={onOpenMenu}
        className={cn(
          '-ms-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
          'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary',
          'lg:hidden',
        )}
        aria-label={t('openMenu')}
      >
        <MenuIcon />
      </button>

      {/* Search — disabled until GET /search is available */}
      <div className="flex-1">
        <label className="sr-only" htmlFor="global-search">
          {t('searchLabel')}
        </label>
        <div className="relative max-w-[440px]">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            id="global-search"
            type="search"
            placeholder={t('searchPlaceholder')}
            disabled
            className={cn(
              'h-10 w-full rounded-md border border-border bg-surface-subtle ps-9 pe-3 text-sm shadow-[var(--shadow-control)]',
              'placeholder:text-muted-foreground/50',
              'disabled:cursor-not-allowed disabled:opacity-60',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-1',
            )}
          />
        </div>
      </div>

      {/* Right cluster */}
      <div className="flex shrink-0 items-center gap-1.5">
        {/* Attention indicator — placeholder; will query GET /attention-items */}
        <AttentionButton t={t} />

        {/* Quick theme toggle */}
        <ThemeToggleButton t={t} />

        {/* User / org menu */}
        <UserMenu />
      </div>
    </header>
  );
}

// ─── Attention indicator (stub) ───────────────────────────────────────────────

function AttentionButton({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <button
      type="button"
      disabled
      aria-label={t('attentionLabel')}
      title={t('attentionNone')}
      className={cn(
        'relative flex h-9 w-9 items-center justify-center rounded-md',
        'text-muted-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <BellIcon />
    </button>
  );
}

// ─── Theme toggle ─────────────────────────────────────────────────────────────

function ThemeToggleButton({ t }: { t: ReturnType<typeof useTranslations> }) {
  const isDark = useResolvedTheme() === 'dark';

  function toggle() {
    setThemePreference(isDark ? 'light' : 'dark');
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t(isDark ? 'themeSwitchToLight' : 'themeSwitchToDark')}
      title={t(isDark ? 'themeSwitchToLight' : 'themeSwitchToDark')}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-md',
        'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary',
      )}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function MenuIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
