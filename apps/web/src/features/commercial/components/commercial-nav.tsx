'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  ListChecks,
  ReceiptText,
  Stamp,
} from 'lucide-react';
import { ViewSwitcher } from '@erp/ui';
import type { BillingModel } from '@erp/types';

/** The read model returns the enum's string form, not the enum member. */
type BillingModelValue = `${BillingModel}`;

export type CommercialTab =
  | 'overview'
  | 'applications'
  | 'contract-milestones'
  | 'billing-collection';

const ICONS: Record<CommercialTab, React.ReactNode> = {
  overview: <LayoutDashboard size={16} strokeWidth={1.9} />,
  applications: <Stamp size={16} strokeWidth={1.9} />,
  'contract-milestones': <ListChecks size={16} strokeWidth={1.9} />,
  'billing-collection': <ReceiptText size={16} strokeWidth={1.9} />,
};

/**
 * Slice 8 — consolidated 3-tab navigation (ADR-030 CONST-COM-026, S-SH-1).
 *
 * Overview → Contract & Milestones → Billing & Collection for all billing models.
 *
 * MEASURED_IPC contracts retain the Applications & Certification chain (IPA → IPC machinery)
 * as their primary operational surface — those routes and components are kept intact.
 *
 * Exported so the route guard and the switcher agree on one rule rather than two copies of it.
 */
export function commercialTabsFor(
  billingModel: BillingModelValue | null | undefined,
): CommercialTab[] {
  if (billingModel === 'MEASURED_IPC') {
    return ['overview', 'applications', 'billing-collection'];
  }
  // MILESTONE (ACCO default) and unknown → 3-tab consolidated layout.
  return ['overview', 'contract-milestones', 'billing-collection'];
}

/**
 * The tab the workspace lands on (S-SH-1, Slice 7). Overview is the universal landing tab —
 * it answers "where are we commercially" for every billing model without requiring a redirect.
 */
export function commercialLandingTab(
  _billingModel: BillingModelValue | null | undefined,
  _hasContract: boolean,
): CommercialTab {
  return 'overview';
}

export function commercialTabHref(projectId: string, tab: CommercialTab): string {
  return `/projects/${projectId}/commercial/${tab}`;
}

/**
 * Commercial internal navigation — a *level-3 local view switch* inside the Commercial module
 * tab (ux-doctrine §5).
 *
 * Underline rather than segmented, matching the Progress sub-tabs on the owner's instruction
 * (2026-09-05): the two workspaces sit under the same project tab row and a reader should not
 * have to learn two different controls for the same job. The separation from the level-2 tabs
 * above comes from a shorter row, a lighter weight, and a glyph on the active view only — which
 * doubles as a non-colour signal of where you are.
 *
 * Unlike Progress (client-side state), these are real routes and stay deep-linkable: the switcher
 * runs in **link mode** via `renderLink`, setting `aria-current="page"` on the active view. It
 * scrolls within itself at 375px, so it serves mobile too — no separate `<Select>`.
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

  return (
    <ViewSwitcher
      appearance="underline"
      aria-label={t('label')}
      value={active}
      items={tabs.map((tab) => ({
        value: tab,
        label: t(tab),
        href: commercialTabHref(projectId, tab),
        icon: ICONS[tab],
      }))}
      renderLink={({ href: linkHref, active: isActive, className, children, key }) => (
        <Link
          key={key}
          href={linkHref}
          aria-current={isActive ? 'page' : undefined}
          className={className}
        >
          {children}
        </Link>
      )}
    />
  );
}
