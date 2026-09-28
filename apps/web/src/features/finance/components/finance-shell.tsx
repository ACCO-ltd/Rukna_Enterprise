'use client';

import { useTranslations } from 'next-intl';

import { WorkspaceSubNav } from '@/components/layout/workspace-sub-nav';
import { WorkspaceSectionHeader } from '@/components/layout/workspace-section-header';

/**
 * The project Finance workspace shell.
 *
 * Four views, named for the question each answers rather than for the read model behind it:
 * Overview (can I trust these numbers, and what do they say), Cost Control (what did we plan and
 * where is it going), Profit & Loss (what did the accounts recognise), Ledger (show me the
 * postings). The tab used to be a single Project Actual P&L, which is a subset presented as the
 * whole.
 */
const VIEWS = [
  { key: 'overview', segment: '' },
  { key: 'costControl', segment: 'cost-control' },
  { key: 'profitLoss', segment: 'profit-loss' },
  { key: 'ledger', segment: 'ledger' },
] as const;

export function FinanceShell({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('finance.shell');
  const base = `/projects/${projectId}/finance`;

  return (
    <div className="space-y-6">
      <WorkspaceSectionHeader title={t('title')} description={t('subtitle')} />

      <WorkspaceSubNav
        label={t('title')}
        items={VIEWS.map((view) => ({
          value: view.key,
          label: t(`views.${view.key}`),
          href: view.segment ? `${base}/${view.segment}` : base,
        }))}
      />

      {children}
    </div>
  );
}
