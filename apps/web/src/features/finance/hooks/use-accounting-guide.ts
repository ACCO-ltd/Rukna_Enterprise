'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AccountingGuideResponse, GuideCycle, GuideCycleKey } from '@erp/types';

import { usePermissions } from '@/features/auth/permissions/can';

import { getAccountingGuide } from '../api/finance-api';

/**
 * The Accounting "Get started" guide (`GET /accounting/guide`) — the read model behind the guide
 * hub, the cycle-status strip and the inline next-step hints. Every step's state is derived live
 * on the server from real data (readiness, pending-document counts, period + fiscal-year state),
 * so it is always truthful and never a stored flag.
 *
 * Held only for readers who may view accounting; for anyone else the query stays idle and callers
 * treat an undefined result as "no guidance to show" rather than blocking. Short stale window so a
 * queue count reflects work done a moment ago on another screen.
 */
export function useAccountingGuide(): UseQueryResult<AccountingGuideResponse, Error> {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ['accounting', 'guide'] as const,
    queryFn: getAccountingGuide,
    enabled: can('view:accounting'),
    staleTime: 15_000,
  });
}

/** The one cycle by key, or undefined while the guide is unknown. */
export function findCycle(
  guide: AccountingGuideResponse | undefined,
  key: GuideCycleKey,
): GuideCycle | undefined {
  return guide?.cycles.find((cycle) => cycle.key === key);
}

/**
 * How many items across the daily cycle are waiting on the user, summed from the ATTENTION
 * steps' counts. The number the cycle-status strip shows. Zero when the guide is unknown or
 * nothing waits — the strip then says the period is clear rather than showing a count.
 */
export function awaitingCount(guide: AccountingGuideResponse | undefined): number {
  const daily = findCycle(guide, 'daily');
  if (!daily) return 0;
  return daily.steps.reduce(
    (sum, step) => (step.status === 'ATTENTION' ? sum + (step.count ?? 0) : sum),
    0,
  );
}

/**
 * What the strip offers when there is no open period, taken from the setup cycle's own links so
 * it never offers what the user cannot do (a RESTRICTED step comes back with no `href`).
 *
 * An empty chart comes first (the chart step links to the one-step setup only then): no period
 * can exist until accounting is set up, and the setup installs the first fiscal year with it.
 * Otherwise the fiscal-year step links to the periods screen, where a year is created or a
 * closed period reopened. `null` when neither is on offer.
 */
export function noPeriodAction(
  guide: AccountingGuideResponse | undefined,
): { kind: 'setUp' | 'openPeriod'; href: string } | null {
  const setup = findCycle(guide, 'setup');
  const chart = setup?.steps.find((step) => step.key === 'chart-of-accounts');
  if (chart?.href?.includes('setup=template')) {
    return { kind: 'setUp', href: chart.href };
  }
  const year = setup?.steps.find((step) => step.key === 'fiscal-year');
  if (year?.href && year.status !== 'RESTRICTED') return { kind: 'openPeriod', href: year.href };
  return null;
}
