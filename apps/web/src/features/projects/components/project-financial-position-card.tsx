'use client';

/**
 * Project Financial Position (ADR-013) — what the project has spent, what it has
 * committed to spend, and what it budgeted to spend.
 *
 * **There is no forecast here, deliberately.** This card used to lead with "Forecast
 * margin" and "Forecast cost", both computed from `actual + committed + accrued`. That
 * expression contains no estimate of cost still to come, so a project with no open
 * purchase orders reported cost-at-completion equal to cost-to-date and a margin equal
 * to the entire contract. The error only ever ran one way — understate cost, overstate
 * margin — and it was worst at the start of a job, when the number matters most. A real
 * forecast needs remaining scope valued at a cost rate, and the platform has no cost
 * rates yet (BOQ rates are sell rates). Until it does, this reports what is known.
 *
 * Gated on `view:financial-position` — the card is not rendered without it (the endpoint
 * would 403), leaving the accounting P&L below for `view:accounting` holders.
 */

import { useLocale, useTranslations } from 'next-intl';
import { Alert } from '@erp/ui';

import { usePermissions } from '@/features/auth/permissions/can';
import { useProjectFinancialPosition } from '@/features/accounting/hooks/use-accounting';
import { formatMoney } from '@/lib/format';

const FINANCIAL_POSITION_VIEW = 'view:financial-position' as const;

export function ProjectFinancialPositionCard({ projectId }: { projectId: string }) {
  const t = useTranslations('accounting.projectFinancialPosition');
  const tShared = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const { can } = usePermissions();
  const canView = can(FINANCIAL_POSITION_VIEW);

  // Gate the request on the permission: without it the query is disabled, so the frontend
  // never sends a call it would only 403 on. The endpoint remains the security boundary.
  const fp = useProjectFinancialPosition(projectId, { enabled: canView });

  // No permission → no card, matching the existing UX.
  if (!canView) return null;

  const money = (amount: string | null, currency: string | null): string => {
    if (amount === null) return tShared('notAvailable');
    return currency ? (formatMoney(amount, currency, locale) ?? amount) : amount;
  };

  return (
    <section aria-labelledby="fp-heading" className="space-y-4">
      <div>
        <h2 id="fp-heading" className="text-lg font-semibold text-foreground">
          {t('title')}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('hint')}</p>
      </div>

      {fp.isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tShared('loading')}</span>
          <div
            className="h-40 animate-pulse rounded-panel border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : fp.isError ? (
        <Alert variant="error" messages={[t('loadFailed')]} />
      ) : (
        <div className="space-y-4">
          {!fp.data.hasContract ? (
            <Alert variant="info" messages={[t('noContract')]} />
          ) : null}
          {/* Said once, plainly, rather than implied by a row of missing percentages. */}
          {!fp.data.hasBudget ? (
            <Alert variant="info" messages={[t('noBudget')]} />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Cost — always present; the ledger stages stay apart on purpose. */}
            <MetricGroup label={t('cost')}>
              <Metric
                label={t('budgetTotal')}
                value={money(fp.data.budgetTotal, fp.data.currency)}
                hint={t('budgetTotalHint')}
              />
              <Metric
                label={t('openCommitment')}
                value={money(fp.data.openCommitment, fp.data.currency)}
                hint={t('openCommitmentHint')}
              />
              <Metric
                label={t('accruedCost')}
                value={money(fp.data.accruedCost, fp.data.currency)}
                hint={t('accruedCostHint')}
              />
              <Metric
                label={t('actualCost')}
                value={money(fp.data.actualCost, fp.data.currency)}
                hint={t('actualCostHint')}
                emphasis
              />
              <Metric
                label={t('uncommittedBudget')}
                value={money(fp.data.uncommittedBudget, fp.data.currency)}
                hint={t('uncommittedBudgetHint')}
              />
            </MetricGroup>

            {/* Revenue — only meaningful with a contract. */}
            {fp.data.hasContract ? (
              <MetricGroup label={t('revenue')}>
                <Metric label={t('contractValue')} value={money(fp.data.contractValue, fp.data.currency)} />
                <Metric label={t('certifiedRevenue')} value={money(fp.data.certifiedRevenue, fp.data.currency)} />
                <Metric label={t('invoicedRevenue')} value={money(fp.data.invoicedRevenue, fp.data.currency)} />
                <Metric label={t('receivedRevenue')} value={money(fp.data.receivedRevenue, fp.data.currency)} />
                <Metric label={t('outstandingReceivables')} value={money(fp.data.outstandingReceivables, fp.data.currency)} />
              </MetricGroup>
            ) : null}
          </div>

          {/* Certified is pre-VAT and invoiced is VAT-inclusive; stacking them without
              saying so reads as though the project invoiced more than it certified. */}
          {fp.data.hasContract ? (
            <p className="text-xs text-muted-foreground">{t('basisNote')}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function MetricGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-panel border border-border bg-surface p-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </h3>
      <dl className="space-y-2.5">{children}</dl>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-muted-foreground">
        {label}
        {hint ? <span className="ms-1 block text-xs text-muted-foreground/70">{hint}</span> : null}
      </dt>
      <dd
        className={`shrink-0 tabular-nums ${
          emphasis ? 'text-sm font-semibold text-foreground' : 'text-sm text-foreground'
        }`}
      >
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}
