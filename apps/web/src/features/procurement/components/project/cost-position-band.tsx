'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { LtrValue, cn } from '@erp/ui';
import type { ProjectCostPosition } from '@erp/types';

import { formatMoney } from '@/lib/format';

/**
 * Committed → Accrued → Actual, and what they are measured against.
 *
 * **The rule this component exists to enforce: no baselined budget means no denominator, and no
 * denominator means the ratio is absent — never `0%`.** A project that has set no budget has not
 * spent 0% of it, and a row of "0.0% of budget" invents a control nobody configured. The band
 * says "Not baselined" once, at the top, and drops every percentage beneath.
 *
 * Each ratio is labelled with its own numerator (`Committed / budget`), never a bare "% of
 * budget" — with three cost stages on the same band, an unlabelled percentage is a guessing game
 * about which one it divides.
 */
export function CostPositionBand({
  position,
  budgetHref,
  canManageBudget,
  className,
}: {
  position: ProjectCostPosition;
  /** Where to set the budget. Only rendered when the route exists and the caller may use it. */
  budgetHref?: string | null;
  canManageBudget?: boolean;
  className?: string;
}) {
  const t = useTranslations('procurement.project.position');
  const locale = useLocale() as 'en' | 'ar';
  const hasBudget = position.budgetTotal !== null;

  const money = (value: string | null) =>
    value === null ? null : (formatMoney(value, position.currency, locale) ?? null);

  const stages = [
    {
      key: 'committed',
      value: money(position.committed),
      percent: position.committedOfBudgetPercent,
      ratioLabel: t('committedOfBudget'),
    },
    {
      key: 'accrued',
      value: money(position.accrued),
      percent: position.accruedOfBudgetPercent,
      ratioLabel: t('accruedOfBudget'),
    },
    {
      key: 'actual',
      value: money(position.actual),
      percent: position.actualOfBudgetPercent,
      ratioLabel: t('actualOfBudget'),
    },
  ];

  return (
    <section
      className={cn(
        'min-w-0 overflow-hidden rounded-panel border border-border bg-surface',
        className,
      )}
    >
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-border px-4 sm:px-5">
        <h3 className="text-h3 font-semibold text-foreground">
          {t('title')}
          {position.currency ? (
            <span className="ms-1.5 font-normal text-caption text-muted-foreground">
              ({position.currency})
            </span>
          ) : null}
        </h3>
        {/* Said once, plainly, rather than implied by three missing percentages. */}
        {!hasBudget ? (
          <span className="inline-flex items-center gap-2 text-caption text-muted-foreground">
            {t('noBudget')}
            {budgetHref && canManageBudget ? (
              <Link
                href={budgetHref}
                className="font-medium text-brand-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
              >
                {t('setBudget')}
              </Link>
            ) : null}
          </span>
        ) : null}
      </div>

      <dl className={cn('grid grid-cols-1 sm:grid-cols-2', hasBudget ? 'xl:grid-cols-5' : 'xl:grid-cols-3')}>
        {hasBudget ? (
          <Cell
            label={t('budget')}
            value={money(position.budgetTotal)}
            support={t('budgetBasis')}
          />
        ) : null}

        {stages.map((stage) => (
          <Cell
            key={stage.key}
            label={t(stage.key)}
            value={stage.value}
            // The ratio appears only when there is a budget, and always carries its own name.
            support={
              stage.percent === null ? t(`${stage.key}Basis`) : `${stage.ratioLabel} ${stage.percent}%`
            }
          />
        ))}

        {hasBudget ? (
          <Cell
            label={t('uncommittedBudget')}
            value={money(position.uncommittedBudget)}
            support={t('uncommittedBudgetBasis')}
          />
        ) : null}
      </dl>

      {/* Two remainders that must never be read as one. Stated as a footnote rather than a fifth
          card, because the distinction matters more than the number does. */}
      {hasBudget ? (
        <p className="border-t border-border px-4 py-2 text-caption text-muted-foreground sm:px-5">
          {t('remainderNote', {
            uncommitted: money(position.uncommittedBudget) ?? '—',
            lessActual: money(position.budgetLessActual) ?? '—',
          })}
        </p>
      ) : null}
    </section>
  );
}

function Cell({
  label,
  value,
  support,
}: {
  label: string;
  value: string | null;
  support?: string | null;
}) {
  const t = useTranslations('procurement.project.position');
  return (
    <div className="border-b border-border px-4 py-3.5 last:border-b-0 sm:nth-last-2:border-b-0 sm:odd:border-e xl:border-b-0 xl:not-last:border-e">
      <dt className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1.5">
        {value === null ? (
          // Withheld, not zero. A caller without financial visibility sees an absence that
          // explains itself, never a figure that reads as "nothing spent".
          <span className="text-body-sm font-medium text-muted-foreground">{t('restricted')}</span>
        ) : (
          <LtrValue className="text-h2 font-bold tabular-nums text-foreground">{value}</LtrValue>
        )}
      </dd>
      {support ? <dd className="mt-1 text-caption text-muted-foreground">{support}</dd> : null}
    </div>
  );
}
