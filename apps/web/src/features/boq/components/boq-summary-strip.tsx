'use client';

import type { LucideIcon } from 'lucide-react';
import { CircleDollarSign, FileCheck2, LayoutList, TrendingUp } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { LtrValue } from '@erp/ui';

import { formatMoney } from '@/lib/format';

/**
 * The BOQ facts strip.
 *
 * Copied from `SummaryItem` in `project-workspace-shell.tsx` rather than reinvented: the
 * same rule-separated, radius-free, shadow-free tile row, and the same
 * `sm:odd:border-e lg:not-last:border-e` divider trick — logical properties, so it flips
 * correctly in RTL without an rtl: variant.
 *
 * `StatTile` from `@erp/ui` is the card-shaped alternative. It is not used here: these are
 * facts about one record, not headline figures, and boxing them re-creates the "unrelated
 * tiles" problem the projects redesign was written to fix.
 */
export function BoqSummaryStrip({
  totalAmount,
  currency,
  sectionCount,
  itemCount,
  pricedCount,
  contractBaselineLabel,
  contractBaselineNote,
  canViewCommercials,
}: {
  totalAmount: string | null;
  currency: string;
  sectionCount: number;
  itemCount: number;
  pricedCount: number;
  contractBaselineLabel: string;
  contractBaselineNote: string | null;
  canViewCommercials: boolean;
}) {
  const t = useTranslations('platform.boq.summary');
  const locale = useLocale() as 'en' | 'ar';

  const completeness = itemCount === 0 ? 0 : Math.round((pricedCount / itemCount) * 100);

  return (
    <dl className="grid border-y border-border bg-surface-subtle sm:grid-cols-2 lg:grid-cols-4">
      <SummaryItem
        icon={CircleDollarSign}
        label={t('value')}
        value={
          canViewCommercials
            ? (formatMoney(totalAmount, currency, locale) ?? t('notPriced'))
            : t('restricted')
        }
        supporting={canViewCommercials ? currency : t('restrictedHint')}
      />
      <SummaryItem
        icon={LayoutList}
        label={t('structure')}
        value={t('sectionsAndItems', { sections: sectionCount, items: itemCount })}
        supporting={t('billableItems', { count: itemCount })}
      />
      <SummaryItem
        icon={TrendingUp}
        label={t('pricingCompleteness')}
        value={`${completeness}%`}
        supporting={t('pricedOf', { priced: pricedCount, total: itemCount })}
        // The bar is the one place a proportion beats a number: 96% and 409/426 are the
        // same fact, but "17 still to price" is what the reader acts on.
        progress={completeness}
      />
      <SummaryItem
        icon={FileCheck2}
        label={t('contractBaseline')}
        value={contractBaselineLabel}
        supporting={contractBaselineNote}
      />
    </dl>
  );
}

function SummaryItem({
  icon: Icon,
  label,
  value,
  supporting,
  progress,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  supporting?: string | null;
  progress?: number;
}) {
  return (
    <div className="border-b border-border px-5 py-4 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 sm:odd:border-e lg:border-b-0 lg:not-last:border-e">
      <dt className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
        <Icon size={15} aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-2 truncate text-sm font-semibold text-foreground" title={value}>
        <LtrValue>{value}</LtrValue>
      </dd>
      {supporting ? (
        <dd className="mt-1 truncate text-caption text-muted-foreground">{supporting}</dd>
      ) : null}
      {progress !== undefined ? (
        <dd className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border" aria-hidden="true">
          <div
            className="h-full rounded-full bg-brand-primary transition-[width] duration-[--motion-layout]"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </dd>
      ) : null}
    </div>
  );
}
