'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';

import { usePaymentsNeededCount, useQuotesToChooseCount } from '@/features/procurement/hooks/use-quotations';

import type { ModuleTab } from './module-nav';
import type { NavBadgeKey } from './nav-groups';

export type NavBadgeCounts = Partial<Record<NavBadgeKey, number | null>>;

/** Every badge key present in a tab set — a source is only queried when its tab is on screen. */
export function badgeKeysIn(tabs: ModuleTab[]): NavBadgeKey[] {
  const keys = new Set<NavBadgeKey>();
  for (const tab of tabs) {
    if (tab.kind === 'link' && tab.badge) keys.add(tab.badge);
    if (tab.kind === 'menu') for (const item of tab.items) if (item.badge) keys.add(item.badge);
  }
  return [...keys];
}

/**
 * The live counts for the given badge keys. Each source gates itself on its own permission, so
 * a user who cannot see the item never fires the request.
 */
export function useNavBadgeCounts(keys: NavBadgeKey[]): NavBadgeCounts {
  const quotes = useQuotesToChooseCount({ enabled: keys.includes('quotesToChoose') });
  const payments = usePaymentsNeededCount({ enabled: keys.includes('paymentsNeeded') });
  return { quotesToChoose: quotes, paymentsNeeded: payments };
}

/** A small count pill. Nothing renders for zero or unknown — an empty badge is noise. */
export function NavCount({
  badge,
  count,
  className,
}: {
  badge: NavBadgeKey;
  count: number | null | undefined;
  className?: string;
}) {
  const t = useTranslations('platform.nav');
  if (!count) return null;
  return (
    <span
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-full bg-brand-primary px-1.5 text-micro font-semibold tabular-nums text-brand-on-primary',
        className,
      )}
    >
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{t(`${badge}Count`, { count })}</span>
    </span>
  );
}
