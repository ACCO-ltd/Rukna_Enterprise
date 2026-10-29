'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Button, EmptyState, MoneyDisplay, SkeletonTable, StatusPill, type StatusTone } from '@erp/ui';
import { PERMISSIONS, type BankTransferView } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { LoadError } from '@/components/load-error';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { usePermissions } from '@/features/auth/permissions/can';
import { useSession } from '@/features/auth/session/use-session';
import { ApiError } from '@/lib/api-client';
import { cn } from '@erp/ui';
import { formatDate } from '@/lib/format';

import { TransferDialog } from './transfer-dialog';
import { useBankTransfers, useDecideTransfer } from './transfers-api';

const TONE: Record<BankTransferView['status'], StatusTone> = {
  PENDING_APPROVAL: 'attention',
  POSTED: 'neutral',
  REJECTED: 'historical',
  REVERSED: 'historical',
};

/**
 * B-2 — money moved between the organisation's own accounts: a bank to a cash box, a float top-up,
 * bank to bank. A transfer above the payment limit waits here for someone other than the person
 * who asked (the Approvals inbox links to it); a posted one can be reversed.
 */
export function TransfersList() {
  const t = useTranslations('finance.transfers');
  const { can } = usePermissions();
  const mayManage = can(PERMISSIONS.accountingManage);
  const { user } = useSession();
  const highlight = useSearchParams()?.get('highlight') ?? null;
  const list = useBankTransfers();
  const decide = useDecideTransfer();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<{ transfer: BankTransferView; action: 'reject' | 'reverse' } | null>(null);
  const errorText = decide.isError ? (decide.error instanceof ApiError ? decide.error.message : t('failed')) : undefined;

  const newButton = mayManage ? (
    <Button type="button" onClick={() => setCreating(true)}>
      <Plus size={14} aria-hidden="true" /> {t('new')}
    </Button>
  ) : null;

  return (
    <div className="space-y-6">
      <ListPageHeader title={t('title')} summary={t('subtitle')} actions={newButton} />
      {list.isError ? (
        <LoadError message={t('loadFailed')} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <SkeletonTable rows={4} columns={5} label={t('loading')} />
      ) : list.data.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('empty')} action={newButton ?? undefined} />
      ) : (
        <div className="overflow-x-auto rounded-panel border border-border bg-surface">
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
              {list.data.map((tr) => {
                const mine = tr.requestedBy === user?.id;
                return (
                  <tr key={tr.id} className={cn('border-b border-border last:border-b-0', highlight === tr.id && 'bg-brand-primary/5')}>
                    <th scope="row" className="px-4 py-2 text-start font-normal">
                      <span className="block font-medium text-foreground">{tr.transferNumber ?? t('unnumbered')}</span>
                      <span className="block text-caption text-muted-foreground">{formatDate(tr.transferDate)}</span>
                    </th>
                    <td className="px-3 py-2">
                      <span className="block">{tr.fromAccountName} → {tr.toAccountName}</span>
                      <span className="block text-caption text-muted-foreground">
                        {[tr.memo, tr.reference, tr.requestedByName ? t('requestedBy', { name: tr.requestedByName }) : null].filter(Boolean).join(' · ')}
                      </span>
                      {tr.status === 'REJECTED' && tr.rejectionReason ? <span className="block text-caption text-muted-foreground">{t('rejectedBecause', { reason: tr.rejectionReason })}</span> : null}
                      {tr.status === 'REVERSED' && tr.reversalReason ? <span className="block text-caption text-muted-foreground">{t('reversedBecause', { reason: tr.reversalReason })}</span> : null}
                    </td>
                    <td className={cn('px-3 py-2 text-end tabular-nums', (tr.status === 'REJECTED' || tr.status === 'REVERSED') && 'text-muted-foreground line-through')}>
                      <MoneyDisplay value={tr.amount} />
                    </td>
                    <td className="px-3 py-2"><StatusPill tone={TONE[tr.status]}>{t(`status.${tr.status}`)}</StatusPill></td>
                    <td className="px-4 py-2 text-end">
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
      )}
      {decide.isError && !pending ? <p className="text-body-sm text-danger">{errorText}</p> : null}

      <TransferDialog open={creating} onOpenChange={setCreating} />

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
