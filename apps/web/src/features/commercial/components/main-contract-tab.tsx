'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Alert, Badge } from '@erp/ui';
import { EmptyState } from '@/components/empty-state';
import { formatDate, formatMoney } from '@/lib/format';
import type { CommercialSummaryResponse } from '@erp/types';

import { contractStatusTone } from '../presentation';
import { FactRow, SectionCard } from './commercial-ui';

/** C2 — Main Contract. Baseline is read-only once past DRAFT (CONST-COM-001). */
export function MainContractTab({ summary }: { summary: CommercialSummaryResponse }) {
  const t = useTranslations('commercial');
  const locale = useLocale() as 'en' | 'ar';
  const contract = summary.mainContract;

  if (!contract) {
    return (
      <EmptyState
        variant="page"
        title={t('overview.noContractTitle')}
        description={t('overview.noContractHint')}
      />
    );
  }

  const value = summary.metrics.contractValue;
  const baselineFrozen = !summary.capabilities.canEditContract && contract.status !== 'DRAFT';

  return (
    <div className="space-y-3">
      {baselineFrozen ? (
        <Alert
          variant="info"
          title={t('mainContract.frozenTitle')}
          messages={[t('mainContract.frozenHint')]}
        />
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard title={t('mainContract.identity')}>
          <FactRow label={t('mainContract.number')}>{contract.contractNumber}</FactRow>
          <FactRow label={t('mainContract.status')}>
            <Badge tone={contractStatusTone(contract.status)}>
              {t(`contractStatus.${contract.status}`)}
            </Badge>
          </FactRow>
          <FactRow label={t('mainContract.client')}>{contract.clientName}</FactRow>
          <FactRow label={t('mainContract.value')}>
            {value.state === 'RESTRICTED'
              ? t('metricState.restricted')
              : value.amount
                ? formatMoney(value.amount, value.currency, locale)
                : '—'}
          </FactRow>
        </SectionCard>

        <SectionCard title={t('mainContract.programme')}>
          <FactRow label={t('mainContract.startDate')}>
            {contract.startDate ? formatDate(contract.startDate, locale) : '—'}
          </FactRow>
          <FactRow label={t('mainContract.expectedEndDate')}>
            {contract.expectedEndDate ? formatDate(contract.expectedEndDate, locale) : '—'}
          </FactRow>
        </SectionCard>

        <SectionCard title={t('retention.title')}>
          {summary.retention ? (
            <>
              <FactRow label={t('retention.rate')}>{percent(summary.retention.retentionRate)}</FactRow>
              <FactRow label={t('retention.cap')}>{percent(summary.retention.retentionCap)}</FactRow>
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
            summary.advances.map((a) => (
              <FactRow key={a.id} label={t(`advances.type.${a.advanceType}`)}>
                {t('advances.recoveryAt', { rate: percent(a.recoveryRate) })}
              </FactRow>
            ))
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
