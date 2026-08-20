'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Alert } from '@erp/ui';
import { EmptyState } from '@/components/empty-state';
import { formatMoney } from '@/lib/format';
import type { CommercialSummaryResponse } from '@erp/types';

import { FactRow, SectionCard } from './commercial-ui';

/**
 * C4 — Retention & Advances (read-first). Shows only the authoritative contractual terms.
 * Held / released / recovered / remaining values are deliberately absent until the backend
 * owns those calculations (ADR-017 deferral) — no release or adjustment actions here.
 */
export function RetentionAdvancesTab({ summary }: { summary: CommercialSummaryResponse }) {
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

  return (
    <div className="space-y-3">
      <Alert variant="info" messages={[t('retentionAdvances.readFirstNote')]} />

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard title={t('retention.title')}>
          {summary.retention ? (
            <>
              <FactRow label={t('retention.rate')}>
                {percent(summary.retention.retentionRate)}
              </FactRow>
              <FactRow label={t('retention.cap')}>
                {percent(summary.retention.retentionCap)}
              </FactRow>
              <FactRow label={t('retention.splitOnPc')}>
                {percent(summary.retention.retentionSplitOnPC)}
              </FactRow>
            </>
          ) : (
            <p className="text-body-sm text-muted-foreground">{t('retention.none')}</p>
          )}
        </SectionCard>

        <SectionCard title={t('advances.title')}>
          {summary.advances.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">{t('advances.none')}</p>
          ) : (
            <div className="space-y-3">
              {summary.advances.map((a) => (
                <div key={a.id} className="rounded-control border border-border p-3">
                  <div className="mb-1 text-body-sm font-medium text-foreground">
                    {t(`advances.type.${a.advanceType}`)}
                  </div>
                  {a.amount ? (
                    <FactRow label={t('advances.amount')}>
                      {formatMoney(a.amount, summary.currency, locale)}
                    </FactRow>
                  ) : a.percentage ? (
                    <FactRow label={t('advances.percentage')}>{percent(a.percentage)}</FactRow>
                  ) : null}
                  <FactRow label={t('advances.recoveryRate')}>{percent(a.recoveryRate)}</FactRow>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );

  function percent(rate: string): string {
    const n = Number(rate);
    if (!Number.isFinite(n)) return rate;
    return `${(n * 100).toFixed(2)}%`;
  }
}
