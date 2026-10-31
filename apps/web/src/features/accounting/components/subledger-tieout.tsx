'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { Button, EmptyState, Notice, SkeletonTable, StatusPill } from '@erp/ui';

import { ListPageHeader } from '@/components/layout/list-page-header';
import { LoadError } from '@/components/load-error';
import { formatDateTime, formatMoney } from '@/lib/format';

import { useReconciliation } from '../hooks/use-accounting';
import type { ControlAccountCheck } from '../types';

const AGING: Record<ControlAccountCheck['subledgerType'], string> = {
  AR: '/finance/accounting/aging/receivables',
  AP: '/finance/accounting/aging/payables',
};

/**
 * GL-L — do the receivable and payable control accounts agree with the invoices and bills still
 * open behind them? Read on arrival. A difference means something posted to the account without a
 * document, or a document changed without posting; it blocks the month-end close.
 */
export function SubledgerTieOut() {
  const t = useTranslations('accounting.tieOut');
  const locale = useLocale() as 'en';
  const report = useReconciliation();
  const usd = (value: string) => formatMoney(value, 'USD', locale) ?? value;

  return (
    <div className="space-y-5">
      <ListPageHeader
        title={t('title')}
        summary={report.data ? t('checkedAt', { time: formatDateTime(report.data.generatedAt, locale) ?? '' }) : undefined}
        actions={
          <Button variant="outline" onClick={() => void report.refetch()} loading={report.isFetching}>
            <RefreshCw size={16} aria-hidden="true" />
            {t('refresh')}
          </Button>
        }
      />

      {report.isError ? (
        <LoadError message={t('loadFailed')} onRetry={() => void report.refetch()} />
      ) : report.isPending ? (
        <SkeletonTable rows={4} columns={3} label={t('title')} />
      ) : report.data.checks.length === 0 ? (
        <EmptyState title={t('noControls')} />
      ) : (
        <>
          {report.data.allReconciled ? null : <Notice tone="danger" title={t('differsTitle')}>{t('differsBody')}</Notice>}
          <div className="grid gap-4 lg:grid-cols-2">
            {report.data.checks.map((c) => (
              <section key={c.accountId} aria-labelledby={`tie-${c.accountId}`} className="rounded-panel border border-border bg-surface p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 id={`tie-${c.accountId}`} className="text-body font-semibold text-foreground">{t(`kind.${c.subledgerType}`)}</h3>
                    <p className="text-caption text-muted-foreground"><span className="font-mono">{c.accountCode}</span> · {c.accountName}</p>
                  </div>
                  <StatusPill tone={c.reconciled ? 'success' : 'danger'}>
                    {c.reconciled ? t('agrees') : t('differs', { amount: usd(c.variance.replace('-', '')) })}
                  </StatusPill>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-body-sm">
                  <div>
                    <dt className="text-caption text-muted-foreground">{t('books')}</dt>
                    <dd className="mt-0.5 font-semibold tabular-nums">{usd(c.glBalance)}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-muted-foreground">{t(`documents.${c.subledgerType}`, { count: c.documentCount })}</dt>
                    <dd className="mt-0.5 font-semibold tabular-nums">{usd(c.subledgerBalance)}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-muted-foreground">{t('difference')}</dt>
                    <dd className={c.reconciled ? 'mt-0.5 font-semibold tabular-nums' : 'mt-0.5 font-semibold tabular-nums text-danger'}>{usd(c.variance)}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-body-sm">
                  <Link href={`/finance/accounting/ledger?accountId=${c.accountId}`} className="font-medium text-brand-primary hover:underline">{t('openLedger')}</Link>
                  <Link href={AGING[c.subledgerType]} className="font-medium text-brand-primary hover:underline">{t(`openAging.${c.subledgerType}`)}</Link>
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
