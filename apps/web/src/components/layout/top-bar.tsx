'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';

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
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-3 sm:px-4">
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
        <div className="relative max-w-md">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            id="global-search"
            type="search"
            placeholder={t('searchPlaceholder')}
            disabled
            className={cn(
              'h-8 w-full rounded-md border border-border bg-muted/50 ps-8 pe-3 text-sm',
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
