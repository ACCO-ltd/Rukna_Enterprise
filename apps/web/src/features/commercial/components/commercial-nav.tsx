'use client';

import { useTranslations } from 'next-intl';
import type { BillingModel } from '@erp/types';

import { WorkspaceSubNav } from '@/components/layout/workspace-sub-nav';

/** The read model returns the enum's string form, not the enum member. */
type BillingModelValue = `${BillingModel}`;

export type CommercialTab = 'contract' | 'applications';

/**
 * The Commercial tab's views. ADR-043 Phase 3 retired Billing here: billing and collection (prepare
 * / issue invoices, send, record payments, reminders) live in Finance → Projects → Billing, and
 * `/commercial/billing` redirects there. What stays is Contract (facts, the payment schedule with a
 * money-free status per stage, variations), plus Applications for a MEASURED_IPC contract (the
 * IPA → IPC chain ACCO's milestone contracts do not use).
 *
 * Exported so the route guard and the switcher agree on one rule rather than two copies of it.
 */
export function commercialTabsFor(billingModel: BillingModelValue | null | undefined): CommercialTab[] {
  return billingModel === 'MEASURED_IPC' ? ['contract', 'applications'] : ['contract'];
}

/** Where `/commercial` lands: Contract, for everyone (billing moved to Finance). */
export const COMMERCIAL_LANDING_TAB: CommercialTab = 'contract';

export function commercialTabHref(projectId: string, tab: CommercialTab): string {
  return `/projects/${projectId}/commercial/${tab}`;
}

/**
 * Level-3 view switch under the bar: real URLs, underline, text only (`WorkspaceSubNav`). With a
 * single view (every milestone contract) there is nothing to switch, so it renders nothing.
 */
export function CommercialNav({
  projectId,
  active,
  billingModel,
}: {
  projectId: string;
  active: CommercialTab;
  billingModel: BillingModelValue | null | undefined;
}) {
  const t = useTranslations('commercial.tabs');
  const tabs = commercialTabsFor(billingModel);
  if (tabs.length < 2) return null;

  return (
    <WorkspaceSubNav
      label={t('label')}
      value={active}
      items={tabs.map((tab) => ({
        value: tab,
        label: t(tab),
        href: commercialTabHref(projectId, tab),
      }))}
    />
  );
}
