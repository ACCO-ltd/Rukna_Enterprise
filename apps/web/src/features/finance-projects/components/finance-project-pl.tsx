'use client';

import { LedgerView, accountingLedgerLinks } from '@/features/finance/components/ledger-view';
import { ProfitLossView } from '@/features/finance/components/profit-loss-view';

/** P&L inside Finance: the project's Profit & Loss, then its ledger with sources opening in Finance. */
export function FinanceProjectPl({ projectId }: { projectId: string }) {
  return (
    <div className="space-y-6">
      <ProfitLossView projectId={projectId} />
      <LedgerView projectId={projectId} links={accountingLedgerLinks} />
    </div>
  );
}
