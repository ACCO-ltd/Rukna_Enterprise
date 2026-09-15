'use client';

import * as React from 'react';
import Link from 'next/link';
import { LockKeyhole, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LtrValue, cn } from '@erp/ui';

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

// The Overview-specific `ContractPositionBand` / `OtherCommercialItemsBand` were retired with the
// Overview tab (C2 / S-SH-5). The shared `PositionBand` above stays — Billing (`BillingPositionBand`)
// and Variations reuse it — but the two Overview compositions and the helpers only they used
// (`fromMetric`, `shareOfContract`, the local `formatPercent`) are gone rather than kept as dead
// exports. The contract-position money remains reachable on Billing, which owns its own band.
