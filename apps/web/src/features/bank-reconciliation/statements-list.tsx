'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { EmptyState, SkeletonTable, StatusPill } from '@erp/ui';
import { PERMISSIONS } from '@erp/types';

import { LoadError } from '@/components/load-error';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { usePermissions } from '@/features/auth/permissions/can';
import { formatDate, formatMoney } from '@/lib/format';

import { bankStatementsApi } from './api';

export const statementKeys = {
  all: ['finance', 'bank-statements'] as const,
  list: () => [...statementKeys.all, 'list'] as const,
  one: (id: string) => [...statementKeys.all, id] as const,
};

const usd = (amount: string) => formatMoney(amount, 'USD') ?? amount;
const IMPORT_HREF = '/finance/accounting/bank-reconciliation/new';
const linkButton =
  'inline-flex min-h-9 items-center gap-1.5 rounded-control bg-brand-primary px-3 text-body-sm font-medium text-brand-on-primary hover:bg-brand-primary-hover';

/** Step 6 — the imported bank statements, newest first, each opening to its matching workspace. */
export function StatementsList() {
  const t = useTranslations('finance.bankRec');
  const { can } = usePermissions();
  const mayImport = can(PERMISSIONS.accountingManage);
  const list = useQuery({ queryKey: statementKeys.list(), queryFn: () => bankStatementsApi.list() });

  return (
    <div className="space-y-6">
      <ListPageHeader
        title={t('title')}
        summary={t('subtitle')}
        actions={mayImport ? (
          <Link href={IMPORT_HREF} className={linkButton}>
            <Plus size={14} aria-hidden="true" /> {t('importStatement')}
          </Link>
        ) : null}
      />
      {list.isError ? (
        <LoadError message={t('loadFailed')} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <SkeletonTable rows={4} columns={5} label={t('loading')} />
      ) : list.data.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('empty')}
          action={mayImport ? <Link href={IMPORT_HREF} className={linkButton}>{t('importStatement')}</Link> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-panel border border-border bg-surface">
          <table className="w-full min-w-[640px] text-body-sm">
            <caption className="sr-only">{t('title')}</caption>
            <thead>
              <tr className="border-b border-border bg-surface-subtle text-caption text-muted-foreground">
                <th scope="col" className="px-4 py-2 text-start font-medium">{t('colAccount')}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t('colPeriod')}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">{t('colClosing')}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">{t('colToMatch')}</th>
                <th scope="col" className="px-4 py-2 text-start font-medium">{t('colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-b-0">
                  <th scope="row" className="px-4 py-2 text-start font-normal">
                    <Link href={`/finance/accounting/bank-reconciliation/${s.id}`} className="font-medium text-brand-primary hover:underline">
                      {s.bankName}
                    </Link>
                    <span className="block text-caption text-muted-foreground">{s.accountName}</span>
                  </th>
                  <td className="px-3 py-2 tabular-nums">
                    {formatDate(s.periodStart) ?? s.periodStart} – {formatDate(s.statementDate) ?? s.statementDate}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{usd(s.closingBalance)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{t('toMatch', { unmatched: s.unmatchedCount, total: s.lineCount })}</td>
                  <td className="px-4 py-2">
                    <StatusPill tone={s.status === 'RECONCILED' ? 'success' : s.unmatchedCount > 0 ? 'attention' : 'progress'}>
                      {t(`status.${s.status}`)}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
