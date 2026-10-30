'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { Button, EmptyState, MoneyDisplay, SkeletonTable, StatTile, StatusPill, type StatusTone } from '@erp/ui';
import { PERMISSIONS, type BankTransferView } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { LoadError } from '@/components/load-error';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { usePermissions } from '@/features/auth/permissions/can';
import { useSession } from '@/features/auth/session/use-session';
import { ApiError } from '@/lib/api-client';
import { cn } from '@erp/ui';
import { formatDate, formatMoney } from '@/lib/format';

import { TransferDialog } from './transfer-dialog';
import { transferTotals, transfersInView, TRANSFER_VIEWS, type TransferView } from './transfer-views';
import { useBankTransfers, useDecideTransfer } from './transfers-api';

const TONE: Record<BankTransferView['status'], StatusTone> = {
  PENDING_APPROVAL: 'attention',
  POSTED: 'neutral',
  REJECTED: 'historical',
  REVERSED: 'historical',
};

/**
 * B-2 / TR — money moved between the organisation's own accounts: a bank to a cash box, a float
 * top-up, bank to bank. A transfer above the payment limit waits here for someone other than the
 * person who asked (the Approvals inbox links to it); a posted one opens its journal and can be
 * reversed. `?account=` shows one account's transfers; `?new=1&from=` opens the form filled.
 */
export function TransfersList() {
  const t = useTranslations('finance.transfers');
  const { can } = usePermissions();
  const mayManage = can(PERMISSIONS.accountingManage);
  const { user } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const highlight = params?.get('highlight') ?? null;
  const accountId = params?.get('account') ?? null;
  const list = useBankTransfers();
  const banks = useBankAccounts();
  const decide = useDecideTransfer();
  const [creating, setCreating] = useState(mayManage && params?.get('new') === '1');
  const [view, setView] = useState<TransferView>('all');
  const [pending, setPending] = useState<{ transfer: BankTransferView; action: 'reject' | 'reverse' } | null>(null);
  const errorText = decide.isError ? (decide.error instanceof ApiError ? decide.error.message : t('failed')) : undefined;

  const account = (banks.data ?? []).find((b) => b.id === accountId) ?? null;
  const ofAccount = useMemo(
    () => (list.data ?? []).filter((tr) => !accountId || tr.fromBankAccountId === accountId || tr.toBankAccountId === accountId),
    [list.data, accountId],
  );
  const rows = transfersInView(ofAccount, view);
  const totals = transferTotals(ofAccount, new Date().toISOString().slice(0, 7));
  const usd = (value: string) => formatMoney(value, 'USD') ?? value;

  // A transfer is numbered when it posts: one waiting has no number yet, one rejected never will.
  const numberWord = (tr: BankTransferView) => (tr.status === 'REJECTED' ? t('notMade') : t('unnumbered'));

  const newButton = mayManage ? (
    <Button type="button" onClick={() => setCreating(true)}>
      <Plus size={14} aria-hidden="true" /> {t('new')}
    </Button>
  ) : null;

  return (
    <div className="space-y-5">
      <ListPageHeader title={t('title')} actions={newButton} />

      {account ? (
        <div className="flex flex-wrap items-center gap-2 text-body-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1">
            {t('forAccount', { name: account.accountName })}
            <button type="button" aria-label={t('clearAccount')} className="text-muted-foreground hover:text-foreground" onClick={() => router.replace(pathname ?? '/finance/accounting/transfers')}>
              <X size={14} aria-hidden="true" />
            </button>
          </span>
        </div>
      ) : null}

      {ofAccount.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatTile label={t('tiles.thisMonth')} value={usd(totals.postedThisMonth)} note={t('tiles.count', { count: totals.postedThisMonthCount })} />
          <StatTile label={t('tiles.waiting')} value={usd(totals.waiting)} note={t('tiles.count', { count: totals.waitingCount })} />
        </div>
      ) : null}

      {list.isError ? (
        <LoadError message={t('loadFailed')} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <SkeletonTable rows={4} columns={5} label={t('loading')} />
      ) : ofAccount.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('empty')} action={newButton ?? undefined} />
      ) : (
        <div className="min-w-0 overflow-hidden rounded-panel border border-border bg-surface">
          <div role="tablist" aria-label={t('viewsLabel')} className="flex gap-1 overflow-x-auto border-b border-border px-3 pt-2">
            {TRANSFER_VIEWS.map((v) => {
              const count = transfersInView(ofAccount, v).length;
              return (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    'min-h-10 whitespace-nowrap border-b-2 px-3 text-body-sm font-medium',
                    view === v ? 'border-brand-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`views.${v}`)} <span className="text-caption text-muted-foreground">{count}</span>
                </button>
              );
            })}
          </div>
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">{t('noneInView')}</p>
          ) : (
            <>
            <ul className="divide-y divide-border sm:hidden" aria-label={t('title')}>
              {rows.map((tr) => {
                const ended = tr.status === 'REJECTED' || tr.status === 'REVERSED';
                return (
                  <li key={tr.id} className={cn('px-4 py-3 text-body-sm', highlight === tr.id && 'bg-brand-primary/5')}>
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">{tr.fromAccountName} → {tr.toAccountName}</span>
                        <span className="block text-caption text-muted-foreground">
                          {[tr.transferNumber ?? numberWord(tr), formatDate(tr.transferDate), tr.memo].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className={cn('shrink-0 font-medium tabular-nums', ended && 'text-muted-foreground line-through')}><MoneyDisplay value={tr.amount} /></span>
                    </div>
                    {tr.status !== 'POSTED' ? <div className="mt-1.5"><StatusPill tone={TONE[tr.status]}>{t(`status.${tr.status}`)}</StatusPill></div> : null}
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[720px] text-body-sm">
                <caption className="sr-only">{t('title')}</caption>
                <thead>
                  <tr className="border-b border-border bg-surface-subtle text-caption text-muted-foreground">
                    <th scope="col" className="px-4 py-2 text-start font-medium">{t('colTransfer')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('colAccounts')}</th>
                    <th scope="col" className="px-3 py-2 text-end font-medium">{t('colAmount')}</th>
                    <th scope="col" className="px-3 py-2 text-start font-medium">{t('colStatus')}</th>
                    <th scope="col" className="px-4 py-2"><span className="sr-only">{t('colActions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((tr) => {
                    const mine = tr.requestedBy === user?.id;
                    const ended = tr.status === 'REJECTED' || tr.status === 'REVERSED';
                    return (
                      <tr key={tr.id} className={cn('border-b border-border last:border-b-0', highlight === tr.id && 'bg-brand-primary/5')}>
                        <th scope="row" className="px-4 py-2.5 text-start align-top font-normal">
                          {tr.journalEntryId ? (
                            <Link href={`/finance/accounting/journals/${tr.journalEntryId}`} className="block font-mono font-medium text-foreground hover:text-brand-primary hover:underline">
                              {tr.transferNumber}
                            </Link>
                          ) : (
                            <span className="block font-medium text-muted-foreground">{numberWord(tr)}</span>
                          )}
                          <span className="block text-caption text-muted-foreground">{formatDate(tr.transferDate)}</span>
                        </th>
                        <td className="px-3 py-2.5 align-top">
                          <span className="block">
                            <Link href={`/finance/accounting/bank-accounts/${tr.fromBankAccountId}`} className="hover:underline">{tr.fromAccountName}</Link>
                            {' → '}
                            <Link href={`/finance/accounting/bank-accounts/${tr.toBankAccountId}`} className="hover:underline">{tr.toAccountName}</Link>
                          </span>
                          <span className="block text-caption text-muted-foreground">
                            {[tr.memo, tr.reference, tr.requestedByName ? t('requestedBy', { name: tr.requestedByName }) : null].filter(Boolean).join(' · ')}
                          </span>
                          {tr.status === 'REJECTED' && tr.rejectionReason ? <span className="block text-caption text-muted-foreground">{t('rejectedBecause', { reason: tr.rejectionReason })}</span> : null}
                          {tr.status === 'REVERSED' && tr.reversalReason ? <span className="block text-caption text-muted-foreground">{t('reversedBecause', { reason: tr.reversalReason })}</span> : null}
                        </td>
                        <td className={cn('px-3 py-2.5 text-end align-top tabular-nums', ended && 'text-muted-foreground line-through')}>
                          <MoneyDisplay value={tr.amount} />
                        </td>
                        <td className="px-3 py-2.5 align-top"><StatusPill tone={TONE[tr.status]}>{t(`status.${tr.status}`)}</StatusPill></td>
                        <td className="px-4 py-2.5 text-end align-top">
                          <span className="inline-flex flex-wrap justify-end gap-2">
                            {mayManage && tr.status === 'PENDING_APPROVAL' && !mine ? (
                              <>
                                <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ id: tr.id, action: 'approve' })}>{t('approve')}</Button>
                                <Button size="sm" variant="outline" onClick={() => setPending({ transfer: tr, action: 'reject' })}>{t('reject')}</Button>
                              </>
                            ) : null}
                            {mayManage && tr.status === 'PENDING_APPROVAL' && mine ? <span className="text-caption text-muted-foreground">{t('waitingForSomeoneElse')}</span> : null}
                            {mayManage && tr.status === 'POSTED' ? (
                              <Button size="sm" variant="outline" onClick={() => setPending({ transfer: tr, action: 'reverse' })}>{t('reverse')}</Button>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      )}
      {decide.isError && !pending ? <p className="text-body-sm text-danger">{errorText}</p> : null}

      <TransferDialog open={creating} onOpenChange={setCreating} initialFrom={params?.get('from') ?? undefined} />

      {pending ? (
        <ConfirmActionDialog
          title={t(`${pending.action}Title`, { ref: pending.transfer.transferNumber ?? t('unnumbered') })}
          description={t(`${pending.action}Body`)}
          confirmLabel={t(pending.action)}
          reason={{ required: true, label: t('reasonPrompt'), maxLength: 500 }}
          destructive={pending.action === 'reverse'}
          isPending={decide.isPending}
          errorMessage={errorText}
          onConfirm={(reason) => decide.mutate({ id: pending.transfer.id, action: pending.action, reason }, { onSuccess: () => setPending(null) })}
          onDismiss={() => { decide.reset(); setPending(null); }}
        />
      ) : null}
    </div>
  );
}
