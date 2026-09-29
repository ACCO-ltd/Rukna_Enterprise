'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AccountingGuideResponse, GuideCycle, GuideCycleKey, GuideStep } from '@erp/types';

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

/** The one step within a cycle by key, or undefined while the guide is unknown. */
export function findStep(
  guide: AccountingGuideResponse | undefined,
  cycleKey: GuideCycleKey,
  stepKey: string,
): GuideStep | undefined {
  return findCycle(guide, cycleKey)?.steps.find((step) => step.key === stepKey);
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
