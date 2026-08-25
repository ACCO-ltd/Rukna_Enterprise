'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';

import { CommandMenuTrigger } from '@/features/command-menu/command-menu-trigger';

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
 *  - Command-menu (⌘K) trigger — the leading affordance
 *  - User avatar menu (theme selection lives inside it — one home)
 *
 * There is no notification bell: `GET /attention-items` does not exist, and a disabled stub
 * for an unbuilt feature is forbidden (ux-doctrine §4). It returns as a live indicator when
 * the endpoint ships. There is no separate theme toggle either — the account menu owns theme.
 *
 * When a project workspace is active the breadcrumbs and page title live in the `PageHeader`
 * component below this bar, not in the bar itself. This bar is intentionally
 * content-agnostic to stay usable at every nesting level.
 *
 * The 56px (`h-14`) height matches the sidebar brand header so the header band aligns.
 */
export function TopBar({ onOpenMenu }: TopBarProps) {
  const t = useTranslations('platform.shell');

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-3 shadow-[var(--shadow-control)] sm:px-5 lg:px-8">
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

      {/* Command menu — leading affordance, replaces the old empty spacer + search stub */}
      <CommandMenuTrigger />

      {/* Right cluster */}
      <div className="ms-auto flex shrink-0 items-center gap-1.5">
        {/* User / org menu — also the single home for theme selection */}
        <UserMenu />
      </div>
    </header>
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
