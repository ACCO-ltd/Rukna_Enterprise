'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@erp/ui';

import { formatMoney } from '@/lib/format';
import { fromMinorUnits } from '@/lib/money';

import type { InvoiceSummary } from '../invoice-summary';

type Tone = 'neutral' | 'danger' | 'primary' | 'success' | 'historical';

const TONE: Record<Tone, { dot: string; bar: string; value: string }> = {
  neutral: { dot: 'bg-muted-foreground', bar: 'bg-border-strong', value: 'text-foreground' },
  danger: { dot: 'bg-danger', bar: 'bg-danger', value: 'text-danger' },
  primary: { dot: 'bg-brand-primary', bar: 'bg-brand-primary', value: 'text-foreground' },
  success: { dot: 'bg-success', bar: 'bg-success', value: 'text-foreground' },
  historical: { dot: 'bg-historical', bar: 'bg-historical', value: 'text-foreground' },
};

interface Tile {
  key: string;
  label: string;
  value: string;
  sub: string;
  tone: Tone;
  /** Picking the tile shows those invoices. Absent = a figure with no list behind it. */
  onSelect?: () => void;
}

/**
 * Step 2c (ADR-047): the money summary above the invoice list — what is drafted, overdue, not due
 * yet, collected and held as retention. A tile with a list behind it is a button that applies
 * that view; the colour is never the only signal (each tile is labelled).
 */
export function InvoiceSummaryTiles({
  summary,
  onShowDrafts,
  onShowOverdue,
  onShowNotDue,
}: {
  summary: InvoiceSummary;
  onShowDrafts: () => void;
  onShowOverdue: () => void;
  onShowNotDue: () => void;
}) {
  const t = useTranslations('accounting.invoices.summary');
  const locale = useLocale() as 'en' | 'ar';

  if (summary.mixedCurrencies) {
    return <p className="text-body-sm text-muted-foreground">{t('mixedCurrencies')}</p>;
  }
  const money = (minor: number) => formatMoney(fromMinorUnits(minor, 2), summary.currency, locale) ?? '—';

  const tiles: Tile[] = [
    {
      key: 'draft',
      label: t('draft'),
      value: money(summary.draft.totalMinor),
      sub: t('draftSub', { count: summary.draft.count }),
      tone: 'neutral',
      onSelect: onShowDrafts,
    },
    {
      key: 'overdue',
      label: t('overdue'),
      value: money(summary.overdue.outstandingMinor),
      sub:
        summary.overdue.count > 0
          ? t('overdueSub', { count: summary.overdue.count, days: summary.overdue.oldestDaysLate })
          : t('overdueNone'),
      tone: summary.overdue.count > 0 ? 'danger' : 'neutral',
      onSelect: onShowOverdue,
    },
    {
      key: 'notDue',
      label: t('notDue'),
      value: money(summary.notDue.outstandingMinor),
      sub: t('invoices', { count: summary.notDue.count }),
      tone: 'primary',
      onSelect: onShowNotDue,
    },
    {
      key: 'collected',
      label: t('collected'),
      value: money(summary.collected.collectedMinor),
      sub: t('paidSub', { count: summary.collected.paidCount }),
      tone: 'success',
    },
    {
      key: 'retention',
      label: t('retention'),
      value: money(summary.retentionHeld.heldMinor),
      sub: t('contracts', { count: summary.retentionHeld.contracts }),
      tone: 'historical',
    },
  ];

  return (
    <ul className="grid grid-cols-1 overflow-hidden rounded-panel border border-border bg-surface sm:grid-cols-2 lg:grid-cols-5">
      {tiles.map((tile) => {
        const tone = TONE[tile.tone];
        const body = (
          <>
            <span className="flex items-center gap-2 text-body-sm text-muted-foreground">
              <span className={cn('size-2 rounded-full', tone.dot)} aria-hidden="true" />
              {tile.label}
            </span>
            <span className={cn('mt-1 block text-h2 font-semibold tabular-nums', tone.value)}>{tile.value}</span>
            <span className="mt-0.5 block text-caption text-muted-foreground">{tile.sub}</span>
            <span className={cn('absolute inset-x-0 bottom-0 h-0.5', tone.bar)} aria-hidden="true" />
          </>
        );
        return (
          <li key={tile.key} className="border-b border-border last:border-b-0 sm:border-e lg:border-b-0 lg:last:border-e-0">
            {tile.onSelect ? (
              <button
                type="button"
                onClick={tile.onSelect}
                className="relative block h-full w-full px-4 py-3 text-start transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary"
                aria-label={t('show', { label: tile.label, value: tile.value })}
              >
                {body}
              </button>
            ) : (
              <div className="relative h-full px-4 py-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
