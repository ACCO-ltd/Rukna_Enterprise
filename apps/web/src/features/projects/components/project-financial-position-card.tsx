'use client';

/**
 * Project Financial Position (ADR-013) — the PM/control view: posted actuals **plus** remaining
 * committed cost, so forecast margin is honest. This sits above the Project Actual P&L, which is
 * posted GL only; committed cost is the whole reason the two are separate.
 *
 * Gated on `view:financial-position` — the card is not rendered without it (the endpoint would
 * 403), leaving the accounting P&L below for `view:accounting` holders.
 */

import { useLocale, useTranslations } from 'next-intl';
import { Alert, Badge } from '@erp/ui';

import { usePermissions } from '@/features/auth/permissions/can';
import { useProjectFinancialPosition } from '@/features/accounting/hooks/use-accounting';
import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, toMinorUnits } from '@/lib/money';

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

          {/* Forecast margin — the number this whole view exists to make honest. */}
          <ForecastMargin
            value={fp.data.forecastMargin}
            currency={fp.data.currency}
            money={money}
            label={t('forecastMargin')}
            hint={t('forecastMarginHint')}
          />

          <div className="grid gap-4 sm:grid-cols-2">
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

            {/* Cost — always present; remaining committed is the mandatory addition. */}
            <MetricGroup label={t('cost')}>
              <Metric label={t('actualCost')} value={money(fp.data.actualCost, fp.data.currency)} />
              <Metric
                label={t('remainingCommitments')}
                value={money(fp.data.remainingCommitments, fp.data.currency)}
                hint={t('committedHint')}
              />
              <Metric label={t('forecastCost')} value={money(fp.data.forecastCost, fp.data.currency)} emphasis />
            </MetricGroup>
          </div>
        </div>
      )}
    </section>
  );
}

function ForecastMargin({
  value,
  currency,
  money,
  label,
  hint,
}: {
  value: string | null;
  currency: string | null;
  money: (amount: string | null, currency: string | null) => string;
  label: string;
  hint: string;
}) {
  const negative = value !== null && toMinorUnits(value, MONEY_SCALE) < 0;

  return (
    <div className="rounded-panel border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        {value !== null ? (
          <Badge tone={negative ? 'danger' : 'live'}>{negative ? '−' : '+'}</Badge>
        ) : null}
      </div>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          negative ? 'text-danger' : 'text-foreground'
        }`}
      >
        <bdi>{money(value, currency)}</bdi>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
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
