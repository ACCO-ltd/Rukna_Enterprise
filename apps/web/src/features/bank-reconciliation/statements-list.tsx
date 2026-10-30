'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { EmptyState, SkeletonTable, StatusPill } from '@erp/ui';
import { PERMISSIONS } from '@erp/types';

import { LoadError } from '@/components/load-error';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
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

/**
 * Step 6 / BR — where each account stands (reconciled to which day, statements still open), then
 * the imported statements, newest first, each opening to its matching workspace. `?account=`
 * shows one account's statements.
 */
export function StatementsList() {
  const t = useTranslations('finance.bankRec');
  const { can } = usePermissions();
  const mayImport = can(PERMISSIONS.accountingManage);
  const accountId = useSearchParams()?.get('account') ?? null;
  const router = useRouter();
  const pathname = usePathname();
  const list = useQuery({ queryKey: statementKeys.list(), queryFn: () => bankStatementsApi.list() });
  const banks = useBankAccounts();
  const accounts = (banks.data ?? []).filter((b) => b.status !== 'CLOSED' && b.isReconcilable !== false && (b.kind ?? 'BANK') === 'BANK');
  const account = (banks.data ?? []).find((b) => b.id === accountId) ?? null;
  const rows = (list.data ?? []).filter((s) => !accountId || s.bankAccountId === accountId);
  const importHref = (id?: string | null) => (id ? `${IMPORT_HREF}?account=${id}` : IMPORT_HREF);

  return (
    <div className="space-y-5">
      <ListPageHeader
        title={t('title')}
        actions={mayImport ? (
          <Link href={importHref(accountId)} className={linkButton}>
            <Plus size={14} aria-hidden="true" /> {t('importStatement')}
          </Link>
        ) : null}
      />

      {!accountId && accounts.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((b) => {
            const open = (list.data ?? []).filter((s) => s.bankAccountId === b.id && s.status === 'OPEN').length;
            return (
              <div key={b.id} className="rounded-panel border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/finance/accounting/bank-accounts/${b.id}`} className="font-medium text-foreground hover:underline">{b.accountName}</Link>
                  {open > 0 ? (
                    <StatusPill tone="attention">{t('card.open', { count: open })}</StatusPill>
                  ) : b.lastReconciledTo ? (
                    <StatusPill tone="success">{t('card.upToDate')}</StatusPill>
                  ) : (
                    <StatusPill tone="neutral">{t('card.never')}</StatusPill>
                  )}
                </div>
                <p className="mt-1 text-body-sm text-muted-foreground">
                  {b.lastReconciledTo
                    ? t('card.reconciledTo', { date: formatDate(b.lastReconciledTo) ?? b.lastReconciledTo, amount: usd(b.lastStatementBalance ?? '0') })
                    : t('card.booksSay', { amount: usd(b.bookBalance ?? '0') })}
                </p>
                <div className="mt-3 flex flex-wrap gap-3 text-body-sm font-medium">
                  <Link href={`?account=${b.id}`} className="text-brand-primary hover:underline">{t('card.statements')}</Link>
                  {mayImport ? <Link href={importHref(b.id)} className="text-brand-primary hover:underline">{t('importStatement')}</Link> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {account ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-body-sm">
          {t('forAccount', { name: account.accountName })}
          <button type="button" aria-label={t('clearAccount')} className="text-muted-foreground hover:text-foreground" onClick={() => router.replace(pathname ?? '/finance/accounting/bank-reconciliation')}>
            <X size={14} aria-hidden="true" />
          </button>
        </span>
      ) : null}
      {list.isError ? (
        <LoadError message={t('loadFailed')} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <SkeletonTable rows={4} columns={5} label={t('loading')} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('empty')}
          action={mayImport ? <Link href={importHref(accountId)} className={linkButton}>{t('importStatement')}</Link> : undefined}
        />
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-panel border border-border bg-surface">
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
              {rows.map((s) => (
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
