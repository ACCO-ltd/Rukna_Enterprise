'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { CostControlView } from '@/features/finance/components/cost-control-view';

import { useFinanceProject } from '../hooks';
import { CashflowView } from './cashflow-view';

/**
 * A page the dashboard opens from one of its cards — Cost detail, the cash-flow forecast. Not a
 * tab: it is a closer look at one Overview figure, so it says where it came from and leads back.
 */
function DrillInHeader({ projectId, title, description }: { projectId: string; title?: string; description?: string }) {
  const t = useTranslations('finance.projects.drillIn');
  return (
    <div className="space-y-1">
      <Link
        href={`/finance/projects/${projectId}`}
        className="inline-flex min-h-9 items-center gap-1.5 text-body-sm font-medium text-brand-primary hover:underline"
      >
        <ArrowLeft size={15} aria-hidden="true" className="rtl:rotate-180" />
        {t('back')}
      </Link>
      {title ? <h2 className="text-h3 font-semibold text-foreground">{title}</h2> : null}
      {description ? <p className="text-caption text-muted-foreground">{description}</p> : null}
    </div>
  );
}

/** Cost detail: the project's cost control (budget, commitments, cost by area / category / supplier). */
export function FinanceProjectCostDetail({ projectId }: { projectId: string }) {
  // The header row is cached; its currency is the contract's, for a project with none of its own.
  const project = useFinanceProject(projectId);
  return (
    <div className="space-y-4" data-finance-cost-detail>
      {/* Cost control titles itself ("Cost control" + what it covers); a second heading would repeat it. */}
      <DrillInHeader projectId={projectId} />
      <CostControlView projectId={projectId} fallbackCurrency={project.data?.item.currency ?? null} />
    </div>
  );
}

/** The project's cash-flow forecast, by week or month. */
export function FinanceProjectCashflowDetail({ projectId }: { projectId: string }) {
  const t = useTranslations('finance.projects.drillIn');
  const project = useFinanceProject(projectId);
  return (
    <div className="space-y-4" data-finance-cashflow-detail>
      <DrillInHeader projectId={projectId} title={t('cashflowTitle')} description={t('cashflowDescription')} />
      <CashflowView projectId={projectId} projectCode={project.data?.item.code} />
    </div>
  );
}
