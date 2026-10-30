'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  cn,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  RecordPanel,
  StatusPill,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { useInvoices } from '@/features/accounting/hooks/use-invoices';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { invoicesForClient, unallocatedMinor } from '../allocation';
import { useApplyOnAccount, useReverseAllocation } from '../hooks/use-receipts';
import type { ReceiptAllocation, ReceiptDetail } from '../types';
import { ApplyInvoicesTable, useApplySplit } from './apply-invoices-table';

const INVOICE_HREF = (id: string) => `/finance/accounting/invoices/${id}`;

/**
 * The invoices a receipt paid. An application made when the receipt posted is undone only by
 * reversing the receipt (the server refuses it alone), so only later ones offer Undo.
 */
export function ReceiptAllocationsPanel({ receipt, canManage }: { receipt: ReceiptDetail; canManage: boolean }) {
  const t = useTranslations('platform.receipts.allocations');
  const locale = useLocale() as 'en' | 'ar';
  const [pendingUndo, setPendingUndo] = useState<ReceiptAllocation | null>(null);
  const undo = useReverseAllocation(receipt.id);
  const money = (value: string) => formatMoney(value, receipt.currencyCode, locale);

  return (
    <RecordPanel title={t('heading')} padded={false}>
      {receipt.allocations.length === 0 ? (
        <p className="px-5 py-6 text-body-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <table className="w-full text-body-sm">
          <thead className="border-b border-border bg-muted text-caption text-muted-foreground">
            <tr>
              <th scope="col" className="px-5 py-2 text-start font-medium">{t('invoice')}</th>
              <th scope="col" className="hidden px-3 py-2 text-start font-medium sm:table-cell">{t('applied')}</th>
              <th scope="col" className="px-3 py-2 text-end font-medium">{t('amount')}</th>
              {canManage ? <th scope="col" className="w-24 px-5 py-2"><span className="sr-only">{t('actions')}</span></th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {receipt.allocations.map((a) => {
              const undone = a.postingStatus === 'REVERSED';
              return (
                <tr key={a.id} className={cn(undone && 'text-muted-foreground')}>
                  <td className="px-5 py-3">
                    <Link
                      href={INVOICE_HREF(a.clientInvoiceId)}
                      className={cn('font-mono font-medium text-brand-primary hover:underline', undone && 'line-through')}
                    >
                      {a.invoiceNumber ?? t('unnumbered')}
                    </Link>
                    {undone ? <StatusPill tone="historical" className="ms-2">{t('undone')}</StatusPill> : null}
                    <span className="block text-caption text-muted-foreground sm:hidden">{formatDate(a.allocationDate, locale)}</span>
                  </td>
                  <td className="hidden px-3 py-3 text-muted-foreground sm:table-cell">
                    {formatDate(a.allocationDate, locale)}
                    {a.atPosting ? null : <span className="ms-1">· {t('later')}</span>}
                  </td>
                  <td className={cn('px-3 py-3 text-end font-medium tabular-nums', undone && 'line-through')}>
                    <bdi>{money(a.allocatedAmount)}</bdi>
                  </td>
                  {canManage ? (
                    <td className="px-5 py-3 text-end">
                      {!undone && !a.atPosting && receipt.postingStatus === 'POSTED' ? (
                        <Button variant="ghost" size="sm" onClick={() => setPendingUndo(a)}>
                          {t('undo')}
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {pendingUndo ? (
        <ConfirmActionDialog
          title={t('undoTitle', { ref: pendingUndo.invoiceNumber ?? t('unnumbered') })}
          description={t('undoBody')}
          confirmLabel={t('undo')}
          isPending={undo.isPending}
          errorMessage={undo.isError ? (undo.error instanceof ApiError ? undo.error.message : t('undoFailed')) : undefined}
          onConfirm={() => undo.mutate(pendingUndo.id, { onSuccess: () => setPendingUndo(null) })}
          onDismiss={() => {
            undo.reset();
            setPendingUndo(null);
          }}
        />
      ) : null}
    </RecordPanel>
  );
}

/** Applies money the receipt holds on account to the client's open invoices, oldest due first. */
export function ApplyOnAccountDialog({ receipt, onClose }: { receipt: ReceiptDetail; onClose: () => void }) {
  const t = useTranslations('platform.receipts.allocations');
  const tApply = useTranslations('platform.receipts.apply');
  const tCommon = useTranslations('common');

  const apply = useApplyOnAccount(receipt.id);
  const invoices = useInvoices({ clientId: receipt.clientId });
  const options = useMemo(() => invoicesForClient(invoices.data ?? [], receipt.clientId), [invoices.data, receipt.clientId]);
  const onAccountMinor = unallocatedMinor(receipt);
  const split = useApplySplit(options, onAccountMinor);
  const blocked = split.appliedMinor === 0 || split.appliedMinor > onAccountMinor || split.overInvoice !== null;

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t('applyTitle')}
      size="lg"
      dirty={split.manual}
      busy={apply.isPending}
    >
      <FormDialogBody className="space-y-4">
        {apply.isError ? (
          <Alert variant="error" messages={[apply.error instanceof ApiError ? apply.error.message : t('failed')]} />
        ) : null}
        <ApplyInvoicesTable options={options} split={split} amountMinor={onAccountMinor} amountLabel={tApply('heldOnAccount')} />
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={apply.isPending}>
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button
          type="button"
          disabled={blocked}
          loading={apply.isPending}
          loadingText={t('applying')}
          onClick={() => apply.mutate(split.allocations(), { onSuccess: onClose })}
        >
          {t('apply')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
