'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@erp/ui';

import { formatMoney } from '@/lib/format';
import { fromMinorUnits } from '@/lib/money';

import type { InvoiceSummary } from '../invoice-summary';

/**
 * The receivables bar above the invoice list: what clients owe, split overdue / not yet due on one
 * bar, then drafts, cash received and retention held. Each figure with a list behind it is a button
 * that applies that view. Money stays neutral; the dot and the bar segment carry the state, and
 * every figure is labelled, so colour is never the only signal.
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
  const locale = useLocale() as 'en';

  if (summary.mixedCurrencies) {
    return <p className="text-body-sm text-muted-foreground">{t('mixedCurrencies')}</p>;
  }
  const money = (minor: number) => formatMoney(fromMinorUnits(minor, 2), summary.currency, locale) ?? '—';

  const owed = summary.outstanding.outstandingMinor;
  const overduePct = owed > 0 ? Math.max(summary.overdue.outstandingMinor > 0 ? 2 : 0, Math.round((summary.overdue.outstandingMinor / owed) * 100)) : 0;
  const metrics: { key: string; label: string; value: string; sub: string; onSelect?: () => void }[] = [
    {
      key: 'draft',
      label: t('draft'),
      value: money(summary.draft.totalMinor),
      sub: t('draftSub', { count: summary.draft.count }),
      onSelect: summary.draft.count > 0 ? onShowDrafts : undefined,
    },
    {
      key: 'collected',
      label: t('collected'),
      value: money(summary.collected.collectedMinor),
      sub: t('paidSub', { count: summary.collected.paidCount }),
    },
    ...(summary.retentionHeld.heldMinor > 0
      ? [
          {
            key: 'retention',
            label: t('retention'),
            value: money(summary.retentionHeld.heldMinor),
            sub: t('contracts', { count: summary.retentionHeld.contracts }),
          },
        ]
      : []),
  ];

  return (
    <section
      aria-label={t('label')}
      className={cn(
        'grid overflow-hidden rounded-panel border border-border bg-surface',
        metrics.length === 3
          ? 'lg:grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,1fr))]'
          : 'lg:grid-cols-[minmax(0,2.2fr)_repeat(2,minmax(0,1fr))]',
      )}
    >
      <div className="space-y-3 px-5 py-4">
        <div>
          <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{t('outstanding')}</p>
          <p className="mt-1 text-h1 font-semibold tabular-nums text-foreground">{money(owed)}</p>
          <p className="text-caption text-muted-foreground">{t('invoices', { count: summary.outstanding.count })}</p>
        </div>
        <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="block h-2 w-full overflow-hidden rounded-full" aria-hidden="true">
          <rect width="100" height="8" className="fill-muted" />
          {owed > 0 ? <rect x={overduePct} width={100 - overduePct} height="8" className="fill-brand-primary/70" /> : null}
          {overduePct > 0 ? <rect width={overduePct} height="8" className="fill-danger" /> : null}
        </svg>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <Segment
            dot="bg-danger"
            label={t('overdue')}
            value={money(summary.overdue.outstandingMinor)}
            sub={summary.overdue.count > 0 ? t('oldest', { days: summary.overdue.oldestDaysLate }) : null}
            onSelect={onShowOverdue}
            ariaLabel={t('show', { label: t('overdue'), value: money(summary.overdue.outstandingMinor) })}
          />
          <Segment
            dot="bg-brand-primary/70"
            label={t('notDue')}
            value={money(summary.notDue.outstandingMinor)}
            sub={null}
            onSelect={onShowNotDue}
            ariaLabel={t('show', { label: t('notDue'), value: money(summary.notDue.outstandingMinor) })}
          />
        </div>
      </div>
      {metrics.map((m) => {
        const body = (
          <>
            <span className="block text-micro font-semibold uppercase tracking-wide text-muted-foreground">{m.label}</span>
            <span className="mt-1 block text-h3 font-semibold tabular-nums text-foreground">{m.value}</span>
            <span className="block text-caption text-muted-foreground">{m.sub}</span>
          </>
        );
        const cell = 'flex h-full flex-col justify-start border-t border-border px-5 py-4 text-start lg:border-s lg:border-t-0';
        return m.onSelect ? (
          <button
            key={m.key}
            type="button"
            onClick={m.onSelect}
            aria-label={t('show', { label: m.label, value: m.value })}
            className={cn(cell, 'transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary')}
          >
            {body}
          </button>
        ) : (
          <div key={m.key} className={cell}>
            {body}
          </div>
        );
      })}
    </section>
  );
}

function Segment({
  dot,
  label,
  value,
  sub,
  onSelect,
  ariaLabel,
}: {
  dot: string;
  label: string;
  value: string;
  sub: string | null;
  onSelect: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={ariaLabel}
      className="-mx-1 flex min-h-11 items-center gap-2 rounded-control px-1 text-start text-body-sm hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-brand-primary"
    >
      <span className={cn('size-2 shrink-0 rounded-full', dot)} aria-hidden="true" />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      {sub ? <span className="text-caption text-muted-foreground">· {sub}</span> : null}
    </button>
  );
}
