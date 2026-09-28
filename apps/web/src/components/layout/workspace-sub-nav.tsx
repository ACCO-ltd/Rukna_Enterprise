'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@erp/ui';

export interface WorkspaceSubNavItem {
  /** Stable key, also used to decide which view is current. */
  value: string;
  label: string;
  href: string;
  /**
   * Items waiting in this view (reports to review). Rendered as a small round pill after the
   * label; omitted entirely — never "0" — when absent or zero.
   */
  count?: number;
  /**
   * The link's accessible name when a count is shown, e.g. "Review, 3 waiting" — the bare badge
   * would otherwise read as "Review 3". Translated by the caller.
   */
  countLabel?: string;
}

// Quiet pills (ADR-038 amendment 2026-09-28). Inactive views are plain muted text; the active
// view is a filled, primary-tinted pill with strong text. No underline track: the project tab
// bar above is the only underline row, so the two levels never read as the same control.
const ITEM_BASE_CLASS = cn(
  'inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 sm:min-h-9',
  'text-body-sm transition-colors duration-(--motion-enter) ease-brand',
  'focus-visible:outline-none focus-visible:shadow-ring',
);
const ITEM_ACTIVE_CLASS = 'bg-brand-accent font-semibold text-brand-ink';
const ITEM_INACTIVE_CLASS = 'font-medium text-muted-foreground hover:text-foreground';

/**
 * The second-level navigation inside a project workspace tab (Progress, Commercial, Finance,
 * Procurement, Documents) — flow plan B2 / NAV-003.
 *
 * One component so every tab's views look and behave alike: quiet pills, text only (icons belong
 * to the project tab bar above), links rather than buttons so every view is deep-linkable. The
 * active link carries `aria-current="page"`. At 375px the row scrolls inside itself rather than
 * wrapping or pushing the page sideways.
 *
 * `value` picks the current view. When omitted, the longest `href` the pathname sits under wins,
 * so a nested route (e.g. `/finance/ledger/123`) keeps its view highlighted.
 */
export function WorkspaceSubNav({
  items,
  value,
  label,
  className,
}: {
  items: WorkspaceSubNavItem[];
  value?: string;
  /** Names the navigation for assistive tech, e.g. "Finance views". */
  label: string;
  className?: string;
}) {
  const pathname = usePathname();
  const current = value ?? currentView(items, pathname);

  return (
    <nav
      aria-label={label}
      className={cn('flex max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden', className)}
    >
      {items.map((item) => {
        const active = item.value === current;
        const showCount = Boolean(item.count && item.count > 0);
        return (
          <Link
            key={item.value}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            aria-label={showCount && item.countLabel ? item.countLabel : undefined}
            className={cn(ITEM_BASE_CLASS, active ? ITEM_ACTIVE_CLASS : ITEM_INACTIVE_CLASS)}
          >
            {item.label}
            {showCount ? (
              <span
                aria-hidden={item.countLabel ? true : undefined}
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-ink px-1.5 text-micro font-semibold tabular-nums text-brand-on-primary"
              >
                {item.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** The item whose href is the longest prefix of the pathname (exact match or a sub-route). */
export function currentView(items: WorkspaceSubNavItem[], pathname: string): string | null {
  const path = pathname.replace(/\/$/, '');
  let best: WorkspaceSubNavItem | null = null;
  for (const item of items) {
    const href = item.href.replace(/\/$/, '');
    if (path === href || path.startsWith(`${href}/`)) {
      if (!best || href.length > best.href.replace(/\/$/, '').length) best = item;
    }
  }
  return best?.value ?? null;
}
