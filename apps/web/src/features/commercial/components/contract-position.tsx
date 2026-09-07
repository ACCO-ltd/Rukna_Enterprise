'use client';

import * as React from 'react';
import Link from 'next/link';
import { LockKeyhole, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { LtrValue, cn } from '@erp/ui';
import type { CommercialMetric, CommercialSummaryResponse } from '@erp/types';

import { formatMoney } from '@/lib/format';

/**
 * The commercial position, as one band of figures rather than a wall of KPI cards.
 *
 * Rules between the cells, not boxes around them: contract value → invoiced → collected →
 * outstanding is a single sentence read left to right, and giving each clause its own card made
 * four measurements of one thing look like four unrelated facts.
 *
 * Money is neutral. A large outstanding balance is not styled as an alarm — whether it is a
 * problem depends on the due dates, which the Billing view states explicitly. Colour here is
 * reserved for a figure the system cannot stand behind.
 */

export interface PositionFigure {
  label: string;
  /** Pre-formatted, or null to render the blank with its reason. */
  value: string | null;
  /** Why the value is blank. Ignored when a value is present. */
  blank?: 'restricted' | 'unavailable' | 'failed' | 'notApplicable';
  /** The line under the figure — a share of contract, a count, a qualifier. */
  support?: string | null;
  /** Makes the figure a link to the list behind it. */
  href?: string | null;
  /** A quieter figure — used for the secondary items band. */
  small?: boolean;
}

export function PositionBand({
  title,
  currency,
  figures,
  className,
}: {
  title: string;
  currency: string | null;
  figures: PositionFigure[];
  className?: string;
}) {
  const columns: 3 | 4 = figures.length >= 4 ? 4 : 3;
  return (
    <section
      className={cn(
        'min-w-0 overflow-hidden rounded-panel border border-border bg-surface',
        className,
      )}
    >
      <div className="flex min-h-11 items-center gap-2 border-b border-border px-4 sm:px-5">
        <h3 className="text-body-sm font-semibold text-foreground">{title}</h3>
        {currency ? (
          <span className="text-caption text-muted-foreground">({currency})</span>
        ) : null}
      </div>
      {/* Two bands sit side by side on a wide screen, so the inner grid opens up one breakpoint
          later than a full-width strip would: four figures across half of 1440 is comfortable,
          four across half of 1024 is not. Below that it folds to two columns rather than
          shrinking the numbers. */}
      <dl className={cn('grid grid-cols-1', columns === 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3')}>
        {figures.map((figure) => (
          <Cell key={figure.label} figure={figure} columns={columns} />
        ))}
      </dl>
    </section>
  );
}

function Cell({ figure, columns }: { figure: PositionFigure; columns: 3 | 4 }) {
  const t = useTranslations('commercial.metricState');

  const body =
    figure.value !== null ? (
      <LtrValue
        className={cn(
          'font-bold tabular-nums text-foreground',
          figure.small ? 'text-h3' : 'text-h2',
        )}
      >
        {figure.value}
      </LtrValue>
    ) : figure.blank === 'restricted' ? (
      <span className="inline-flex items-center gap-1.5 text-body-sm font-medium text-muted-foreground">
        <LockKeyhole size={14} aria-hidden="true" />
        {t('RESTRICTED')}
      </span>
    ) : figure.blank === 'failed' ? (
      <span className="inline-flex items-center gap-1.5 text-body-sm font-medium text-warning">
        <TriangleAlert size={14} aria-hidden="true" />
        {t('FAILED')}
      </span>
    ) : (
      <span className="text-h3 font-bold text-muted-foreground">—</span>
    );

  const support =
    figure.support ??
    (figure.value === null && figure.blank === 'notApplicable' ? t('NOT_APPLICABLE') : null) ??
    (figure.value === null && figure.blank === 'unavailable' ? t('UNAVAILABLE') : null);

  return (
    <div
      className={cn(
        // Logical (`border-e`) so the rules land on the correct edge in RTL without an rtl: variant.
        'border-b border-border px-4 py-3.5 last:border-b-0',
        columns === 4
          ? 'sm:nth-last-2:border-b-0 sm:odd:border-e xl:border-b-0 xl:not-last:border-e'
          : 'sm:border-b-0 sm:not-last:border-e',
      )}
    >
      <dt className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {figure.label}
      </dt>
      <dd className="mt-1.5">
        {/* The drill-down is the figure itself. A "view" link beside every number would be four
            more controls competing with the one primary action on the screen. */}
        {figure.href && figure.value !== null ? (
          <Link
            href={figure.href}
            className="inline-flex min-h-11 items-center rounded-control hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary sm:min-h-0"
          >
            {body}
          </Link>
        ) : (
          body
        )}
      </dd>
      {support ? (
        <dd className="mt-1 text-caption text-muted-foreground">{support}</dd>
      ) : null}
    </div>
  );
}

// ─── The two bands Overview opens with ──────────────────────────────────────────

/** How to render one server metric as a position figure. */
function fromMetric(
  metric: CommercialMetric,
  label: string,
  locale: 'en' | 'ar',
  support?: string | null,
  href?: string | null,
): PositionFigure {
  if (metric.state === 'RESTRICTED') return { label, value: null, blank: 'restricted' };
  if (metric.state === 'FAILED') return { label, value: null, blank: 'failed' };
  if (metric.state === 'UNAVAILABLE') return { label, value: null, blank: 'unavailable' };
  return {
    label,
    value: formatMoney(metric.amount, metric.currency, locale) ?? '—',
    support: support ?? null,
    href: href ?? metric.drillTo,
  };
}

/** A share of the contract value, or null when there is no meaningful denominator. */
function shareOfContract(amount: string | null, contractValue: string | null): number | null {
  if (amount === null || contractValue === null) return null;
  const value = Number(amount);
  const total = Number(contractValue);
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round((value / total) * 1000) / 10;
}

/**
 * Contract value · Invoiced · Collected · Outstanding.
 *
 * The headline "contract value" is the **governing** value — original plus client-approved
 * variations (ADR-026 CONST-VAR-005) — because that is what the contract is worth today and what
 * every share below is a share of. Pending variations are stated separately in the band beneath
 * and are never folded in: a variation the client has not approved is not money.
 */
export function ContractPositionBand({
  summary,
  projectId,
}: {
  summary: CommercialSummaryResponse;
  projectId: string;
}) {
  const t = useTranslations('commercial.position');
  const locale = useLocale() as 'en' | 'ar';
  const { metrics, contractValue, currency } = summary;
  const billing = `/projects/${projectId}/commercial/billing-collection`;

  const governing = contractValue?.governingContractValue ?? null;
  const approved = contractValue?.approvedVariationsTotal ?? null;
  const hasApproved = approved !== null && Number(approved) !== 0;

  const share = (metric: CommercialMetric): string | null => {
    const percent = shareOfContract(metric.amount, governing);
    return percent === null ? null : t('ofContract', { percent: formatPercent(percent) });
  };

  const value: PositionFigure =
    metrics.contractValue.state === 'RESTRICTED'
      ? { label: t('contractValue'), value: null, blank: 'restricted' }
      : {
          label: t('contractValue'),
          value: formatMoney(governing ?? metrics.contractValue.amount, currency, locale) ?? '—',
          // When variations have moved it, say so here rather than leaving a reader to wonder
          // why this figure and the contract document disagree. One short clause: the cell is a
          // quarter of a half-width band, and a full sentence wrapped to five lines and dragged
          // the whole row taller than the three figures beside it.
          support: hasApproved
            ? t('governingIncl', { approved: formatMoney(approved, currency, locale) ?? '—' })
            : t('perContract'),
          href: `/projects/${projectId}/commercial/contract-security`,
        };

  return (
    <PositionBand
      title={t('title')}
      currency={currency}
      figures={[
        value,
        fromMetric(metrics.invoiced, t('invoiced'), locale, share(metrics.invoiced), billing),
        fromMetric(metrics.received, t('collected'), locale, share(metrics.received), billing),
        fromMetric(
          metrics.outstanding,
          t('outstanding'),
          locale,
          share(metrics.outstanding),
          billing,
        ),
      ]}
    />
  );
}

/**
 * The commercial items that are deliberately *not* part of the contract position.
 *
 * Pending variations sit here precisely because they must not be added to contract value
 * (CONST-VAR-006a) — separating them physically is what stops a reader doing the addition in
 * their head. Retention and advance are what the contract terms have actually produced; on a
 * MILESTONE contract neither exists at all, and the band says "not applicable" rather than a zero
 * that would read as "we hold nothing back" (ADR-023 CONST-COM-013/014).
 */
export function OtherCommercialItemsBand({
  summary,
  projectId,
}: {
  summary: CommercialSummaryResponse;
  projectId: string;
}) {
  const t = useTranslations('commercial.position');
  const locale = useLocale() as 'en' | 'ar';
  const { contractValue, securityPosition, currency, financialsVisible } = summary;

  const pending = contractValue?.pendingVariations ?? null;
  const restricted = !financialsVisible;

  const money = (amount: string | null): PositionFigure['value'] =>
    restricted || amount === null ? null : (formatMoney(amount, currency, locale) ?? null);

  const securityBlank: PositionFigure['blank'] = restricted
    ? 'restricted'
    : securityPosition.applicable
      ? 'unavailable'
      : 'notApplicable';

  return (
    <PositionBand
      title={t('otherTitle')}
      currency={currency}
      figures={[
        {
          label: t('pendingVariations'),
          value: money(pending),
          blank: restricted ? 'restricted' : 'unavailable',
          support: t('pendingHint'),
          href: `/projects/${projectId}/commercial/variations`,
          small: true,
        },
        {
          label: t('retentionHeld'),
          value: money(securityPosition.retentionHeld),
          blank: securityBlank,
          support: securityPosition.applicable ? t('retentionHint') : null,
          small: true,
        },
        {
          label: t('advanceOutstanding'),
          value: money(securityPosition.advanceOutstanding),
          blank: securityBlank,
          support: securityPosition.applicable
            ? securityPosition.advanceRecovered !== null
              ? t('advanceRecovered', {
                  amount:
                    formatMoney(securityPosition.advanceRecovered, currency, locale) ?? '—',
                })
              : t('advanceHint')
            : null,
          small: true,
        },
      ]}
    />
  );
}

/** `30` → "30", `30.5` → "30.5". Trailing `.0` on a share reads as false precision. */
function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
