'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { Alert, Badge, Button } from '@erp/ui';
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
    const createUrl = summary.attention.find((item) => item.kind === 'NO_MAIN_CONTRACT')?.actionUrl;
    return (
      <EmptyState
        variant="page"
        title={t('overview.noContractTitle')}
        description={t('overview.noContractHint')}
        action={
          createUrl ? (
            <Button asChild>
              <Link href={createUrl}>{t('attention.NO_MAIN_CONTRACT.action')}</Link>
            </Button>
          ) : undefined
        }
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
            <EmptyTerm
              message={t('retention.none')}
              action={
                summary.capabilities.canEditContract ? t('contractSecurity.manageTerms') : null
              }
              href={`/contracts/${contract.id}/edit`}
            />
          )}
        </SectionCard>

        <SectionCard title={t('advances.title')}>
          {summary.advances.length === 0 ? (
            <EmptyTerm
              message={t('advances.none')}
              action={
                summary.capabilities.canEditContract ? t('contractSecurity.manageTerms') : null
              }
              href={`/contracts/${contract.id}/edit`}
            />
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

function EmptyTerm({
  message,
  action,
  href,
}: {
  message: string;
  action: string | null;
  href: string;
}) {
  return (
    <div className="space-y-3 py-1">
      <p className="text-body-sm text-muted-foreground">{message}</p>
      {action ? (
        <Button asChild variant="outline" size="sm">
          <Link href={href}>{action}</Link>
        </Button>
      ) : null}
    </div>
  );
}
