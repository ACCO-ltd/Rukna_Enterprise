'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { Badge } from '@erp/ui';
import { EmptyState } from '@/components/empty-state';
import { formatDate, formatMoney } from '@/lib/format';
import type { CommercialSummaryResponse } from '@erp/types';

import { guaranteeAttentionTone, guaranteeStatusTone } from '../presentation';
import { FactRow } from './commercial-ui';

/** C5 — Guarantees. Expiry attention is backend-derived (A7), separate from legal status. */
export function GuaranteesTab({ summary }: { summary: CommercialSummaryResponse }) {
  const t = useTranslations('commercial');
  const locale = useLocale() as 'en' | 'ar';

  if (!summary.mainContract) {
    return (
      <EmptyState
        variant="page"
        title={t('overview.noContractTitle')}
        description={t('overview.noContractHint')}
      />
    );
  }

  if (summary.guarantees.length === 0) {
    return (
      <EmptyState
        variant="page"
        icon={<ShieldCheck size={25} strokeWidth={1.8} aria-hidden="true" />}
        title={t('guarantees.emptyTitle')}
        description={t('guarantees.emptyHint')}
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {summary.guarantees.map((g) => (
        <article key={g.id} className="rounded-panel border border-border bg-card p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-body font-semibold text-foreground">
                {humanize(g.guaranteeType)}
              </h3>
              <p className="truncate text-caption text-muted-foreground">{g.issuer}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Badge tone={guaranteeStatusTone(g.status)}>{t(`guaranteeStatus.${g.status}`)}</Badge>
              {g.attention !== 'NONE' ? (
                <Badge tone={guaranteeAttentionTone(g.attention)}>
                  {t(`guaranteeAttention.${g.attention}`)}
                </Badge>
              ) : null}
            </div>
          </div>
          <FactRow label={t('guarantees.amount')}>
            {formatMoney(g.amount, g.currency, locale)}
          </FactRow>
          <FactRow label={t('guarantees.beneficiary')}>{g.beneficiary}</FactRow>
          <FactRow label={t('guarantees.issueDate')}>{formatDate(g.issueDate, locale)}</FactRow>
          <FactRow label={t('guarantees.expiryDate')}>{formatDate(g.expiryDate, locale)}</FactRow>
        </article>
      ))}
    </div>
  );
}

/** Free-form guarantee type (e.g. "PERFORMANCE") → "Performance". Data, not a translation key. */
function humanize(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
