'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { CostCommitmentsView } from './cost-commitments-view';
import { ProjectPurchaseList } from './project-purchase-list';

type View = 'list' | 'cost';

export function PurchasesViewShell({ projectId }: { projectId: string }) {
  const t = useTranslations('procurement.project.purchases.viewToggle');
  const [view, setView] = React.useState<View>('list');

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-border bg-muted p-1 w-fit">
        <button
          type="button"
          onClick={() => setView('list')}
          className={[
            'rounded-md px-3 py-1.5 text-body-sm font-medium transition-colors',
            view === 'list'
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          ].join(' ')}
        >
          {t('list')}
        </button>
        <button
          type="button"
          onClick={() => setView('cost')}
          className={[
            'rounded-md px-3 py-1.5 text-body-sm font-medium transition-colors',
            view === 'cost'
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          ].join(' ')}
        >
          {t('cost')}
        </button>
      </div>

      {view === 'list' ? (
        <ProjectPurchaseList projectId={projectId} />
      ) : (
        <CostCommitmentsView projectId={projectId} />
      )}
    </div>
  );
}
