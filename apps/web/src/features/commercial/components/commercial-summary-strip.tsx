'use client';

import Link from 'next/link';
import type { CommercialMetric, CommercialSummaryResponse } from '@erp/types';
import { LockKeyhole, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { LtrValue, cn } from '@erp/ui';

import { formatMoney } from '@/lib/format';

/**
 * Contract Value · Certified · Invoiced · Outstanding, in one band.
 *
 * One strip with rules between the figures, not four floating cards. The chain
 * certification → invoice → receipt → outstanding is a single story read left to right, and
 * boxing each step made them look like four unrelated measurements of the same thing.
 *
 * Certified deliberately carries **both** gross and net. ADR-017 leaves "which is the
 * headline figure" open pending Eng Ahmed; showing both answers the question honestly
 * instead of guessing, and the gap between them is the deductions — a number a commercial
 * manager wants anyway.
 */
export function CommercialSummaryStrip({
  summary,
}: {
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial');
  const { metrics } = summary;

  return (
    <dl className="grid rounded-panel border border-border bg-surface sm:grid-cols-2 lg:grid-cols-4">
      <Cell
        label={t('metric.contractValue')}
        metric={metrics.contractValue}
        supporting={summary.mainContract?.contractNumber ?? null}
      />
      <Cell
        label={t('metric.certified')}
        metric={metrics.certifiedGross}
        qualifier={t('metric.gross')}
        secondary={metrics.certifiedNet}
        secondaryQualifier={t('metric.net')}
        supporting={t('metric.effectiveCertificates', {
          count: summary.certification.effectiveCertificates,
        })}
      />
      <Cell
        label={t('metric.invoiced')}
        metric={metrics.invoiced}
        supporting={t('metric.postedInvoices', { count: summary.certification.postedInvoices })}
      />
      <Cell
        label={t('metric.outstanding')}
        metric={metrics.outstanding}
        supporting={t('metric.receivablesOutstanding')}
      />
    </dl>
  );
}

function Cell({
  label,
  metric,
  qualifier,
  secondary,
  secondaryQualifier,
  supporting,
}: {
  label: string;
  metric: CommercialMetric;
  qualifier?: string;
  secondary?: CommercialMetric;
  secondaryQualifier?: string;
  supporting: string | null;
}) {
  return (
    // Logical dividers, so the rules land on the correct edge in RTL without an rtl: variant.
    <div className="border-b border-border p-4 last:border-b-0 sm:nth-last-2:border-b-0 sm:odd:border-e lg:border-b-0 lg:not-last:border-e">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>

      <dd className="mt-2">
        <Figure metric={metric} qualifier={qualifier} />
      </dd>

      {secondary ? (
        <dd className="mt-1">
          <Figure metric={secondary} qualifier={secondaryQualifier} small />
        </dd>
      ) : null}

      {supporting ? (
        <dd className="mt-1.5 truncate text-caption text-muted-foreground">{supporting}</dd>
      ) : null}
    </div>
  );
}

/**
 * One figure, honouring the metric's state.
 *
 * `RESTRICTED`, `UNAVAILABLE` and `FAILED` are three different facts and must not collapse
 * into a dash or a zero: withheld, not applicable, and broken lead to three different
 * actions. A zero here would be a lie in all three cases.
 */
function Figure({
  metric,
  qualifier,
  small,
}: {
  metric: CommercialMetric;
  qualifier?: string;
  small?: boolean;
}) {
  const t = useTranslations('commercial.metricState');
  const locale = useLocale() as 'en' | 'ar';

  if (metric.state === 'RESTRICTED') {
    return (
      <span className="inline-flex items-center gap-1.5 text-body-sm font-medium text-muted-foreground">
        <LockKeyhole size={14} aria-hidden="true" />
        {t('RESTRICTED')}
      </span>
    );
  }

  if (metric.state === 'FAILED') {
    return (
      <span className="inline-flex items-center gap-1.5 text-body-sm font-medium text-warning">
        <TriangleAlert size={14} aria-hidden="true" />
        {t('FAILED')}
      </span>
    );
  }

  if (metric.state === 'UNAVAILABLE') {
    return <span className="text-body-sm text-muted-foreground">{t('UNAVAILABLE')}</span>;
  }

  const value = (
    <span className="inline-flex items-baseline gap-1.5">
      <LtrValue
        className={cn(
          'font-semibold tabular-nums text-foreground',
          small ? 'text-body-sm' : 'text-h2',
        )}
      >
        {formatMoney(metric.amount, metric.currency, locale) ?? '—'}
      </LtrValue>
      {qualifier ? <span className="text-caption text-muted-foreground">{qualifier}</span> : null}
    </span>
  );

  // The drill-down is the figure itself. A separate "view" link beside every number would be
  // four more controls competing with the one primary action above.
  return metric.drillTo ? (
    <Link
      href={metric.drillTo}
      className="inline-flex min-h-11 items-center rounded-control hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary sm:min-h-0"
    >
      {value}
    </Link>
  ) : (
    value
  );
}
