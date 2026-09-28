'use client';

import { useTranslations } from 'next-intl';
import type { BillingModel } from '@erp/types';

import { WorkspaceSubNav } from '@/components/layout/workspace-sub-nav';

/** The read model returns the enum's string form, not the enum member. */
type BillingModelValue = `${BillingModel}`;

export type CommercialTab = 'billing' | 'contract' | 'applications';

/**
 * The Commercial tab's views (redesign 2026-09-28): Billing · Contract, plus Applications for a
 * MEASURED_IPC contract (the IPA → IPC chain ACCO's milestone contracts do not use). The Overview
 * view is gone — its figures live in the bar and its "what next" in Billing's To do.
 *
 * Exported so the route guard and the switcher agree on one rule rather than two copies of it.
 */
export function commercialTabsFor(billingModel: BillingModelValue | null | undefined): CommercialTab[] {
  return billingModel === 'MEASURED_IPC' ? ['billing', 'contract', 'applications'] : ['billing', 'contract'];
}

/**
 * Where `/commercial` lands: people who bill and collect (`manage:receivable`) on Billing,
 * everyone else on Contract — the view that answers their question.
 */
export function commercialLandingTab(canBill: boolean): CommercialTab {
  return canBill ? 'billing' : 'contract';
}

export function commercialTabHref(projectId: string, tab: CommercialTab): string {
  return `/projects/${projectId}/commercial/${tab}`;
}

/** Level-3 view switch under the bar: real URLs, underline, text only (`WorkspaceSubNav`). */
export function CommercialNav({
  projectId,
  active,
  billingModel,
  billingCount,
}: {
  projectId: string;
  active: CommercialTab;
  billingModel: BillingModelValue | null | undefined;
  /** Open To do rows — shown as a count on Billing. */
  billingCount?: number;
}) {
  const t = useTranslations('commercial.tabs');

  return (
    <WorkspaceSubNav
      label={t('label')}
      value={active}
      items={commercialTabsFor(billingModel).map((tab) => ({
        value: tab,
        label: t(tab),
        href: commercialTabHref(projectId, tab),
        ...(tab === 'billing' && billingCount ? { count: billingCount } : {}),
      }))}
    />
  );
}
