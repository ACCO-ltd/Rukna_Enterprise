'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  CalendarClock,
  FileSignature,
  GitBranch,
  ReceiptText,
  Stamp,
} from 'lucide-react';
import { ViewSwitcher } from '@erp/ui';
import type { BillingModel } from '@erp/types';

/** The read model returns the enum's string form, not the enum member. */
type BillingModelValue = `${BillingModel}`;

export type CommercialTab =
  | 'contract-security'
  | 'applications'
  | 'payment-schedule'
  | 'variations'
  | 'billing-collection';

const ICONS: Record<CommercialTab, React.ReactNode> = {
  'contract-security': <FileSignature size={16} strokeWidth={1.9} />,
  applications: <Stamp size={16} strokeWidth={1.9} />,
  'payment-schedule': <CalendarClock size={16} strokeWidth={1.9} />,
  variations: <GitBranch size={16} strokeWidth={1.9} />,
  'billing-collection': <ReceiptText size={16} strokeWidth={1.9} />,
};

/**
 * Which views this contract actually has (ADR-030 CONST-COM-026, S-SH-1).
 *
 * Four tabs, not five: Overview is retired (C2). Its live-cycle content moved onto the Payment
 * Schedule tab and its money bands are reachable on Billing, so nothing was lost by removing the
 * landing pad that duplicated them.
 *
 * The billing model chooses ONE of two mutually-exclusive views in the same slot: a MEASURED_IPC
 * contract bills through Applications & Certification (the IPA → IPC machinery), a MILESTONE
 * contract bills from its Payment Schedule instead (ADR-023). Only one applies, so only one is
 * shown — the other would be a permanently empty workspace inviting a user to start a document the
 * server will refuse.
 *
 * A contract with no billing model yet (none, or still loading) shows Applications rather than
 * hiding both — the measured chain is the historical default, and hiding a view because data has
 * not arrived is worse than showing one too many.
 *
 * Exported so the route guard and the switcher agree on one rule rather than two copies of it.
 */
export function commercialTabsFor(
  billingModel: BillingModelValue | null | undefined,
): CommercialTab[] {
  const tabs: CommercialTab[] = ['contract-security'];
  if (billingModel === 'MILESTONE') tabs.push('payment-schedule');
  else tabs.push('applications');
  tabs.push('variations', 'billing-collection');
  return tabs;
}

/**
 * The tab the workspace lands on (S-SH-1). With Overview gone, a MILESTONE contract opens on its
 * Payment Schedule — the operational home where billing happens — and everything else opens on
 * Contract. When there is no contract yet the only meaningful destination is Contract, whatever the
 * (absent) billing model would otherwise say, so the reader lands on the create affordance rather
 * than an empty schedule.
 */
export function commercialLandingTab(
  billingModel: BillingModelValue | null | undefined,
  hasContract: boolean,
): CommercialTab {
  if (!hasContract) return 'contract-security';
  return billingModel === 'MILESTONE' ? 'payment-schedule' : 'contract-security';
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
