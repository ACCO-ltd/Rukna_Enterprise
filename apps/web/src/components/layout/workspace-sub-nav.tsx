'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ViewSwitcher } from '@erp/ui';

export interface WorkspaceSubNavItem {
  /** Stable key, also used to decide which view is current. */
  value: string;
  label: string;
  href: string;
  /** A count shown beside the label, e.g. open To do rows. Omitted or 0 → no badge. */
  count?: number;
}

/**
 * The second-level navigation inside a project workspace tab (Progress, Commercial, Finance,
 * Procurement, Documents) — flow plan B2 / NAV-003.
 *
 * One component so every tab's views look and behave alike: underline, text only (icons belong
 * to the project tab bar above, so the two rows never read as the same level), links rather
 * than buttons so every view is deep-linkable. It used to be five implementations — two
 * ViewSwitchers with icons on the active view, two hand-rolled lists with icons on every view,
 * and one with no overflow handling at all.
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
  const counts = new Map(items.map((item) => [item.href, item.count ?? 0]));

  return (
    <ViewSwitcher
      appearance="underline"
      aria-label={label}
      value={current ?? ''}
      className={className}
      items={items.map(({ value: itemValue, label: itemLabel, href }) => ({
        value: itemValue,
        label: itemLabel,
        href,
      }))}
      renderLink={({ href, active, className: linkClass, children, key }) => (
        <Link key={key} href={href} aria-current={active ? 'page' : undefined} className={linkClass}>
          {children}
          {counts.get(href) ? (
            <span className="ms-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-caption font-semibold tabular-nums text-foreground">
              {counts.get(href)}
            </span>
          ) : null}
        </Link>
      )}
    />
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
