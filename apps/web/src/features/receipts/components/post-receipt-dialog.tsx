'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Select,
} from '@erp/ui';

import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { useInvoices } from '@/features/accounting/hooks/use-invoices';
import { bankAccountLabel } from '@/features/procurement/payment-actions';
import { ApiError } from '@/lib/api-client';

import { invoicesForClient, toMinorUnits } from '../allocation';
import { usePostReceipt } from '../hooks/use-receipts';
import type { ReceiptDetail } from '../types';
import { ApplyInvoicesTable, useApplySplit } from './apply-invoices-table';

/**
 * Post a receipt someone recorded without posting rights (ACC-SET-001 D3): the bank account it
 * landed in, and how it pays the client's open invoices — the same split as Receive payment. What
 * is not applied stays on account. Atomic with its applications on the server.
 */
export function PostReceiptDialog({ receipt, onClose }: { receipt: ReceiptDetail; onClose: () => void }) {
  const t = useTranslations('platform.receipts.post');
  const tApply = useTranslations('platform.receipts.apply');
  const tCommon = useTranslations('common');

  const post = usePostReceipt(receipt.id);
  const bankAccounts = useBankAccounts();
  const invoices = useInvoices({ clientId: receipt.clientId });

  const receivingBanks = useMemo(
    () => (bankAccounts.data ?? []).filter((b) => b.status === 'ACTIVE' && b.allowsReceipts),
    [bankAccounts.data],
  );
  const [chosenBank, setChosenBank] = useState('');
  const bankAccountId = chosenBank || (receivingBanks.length === 1 ? receivingBanks[0]!.id : '');

  const options = useMemo(() => invoicesForClient(invoices.data ?? [], receipt.clientId), [invoices.data, receipt.clientId]);
  const totalMinor = toMinorUnits(receipt.totalAmount);
  const split = useApplySplit(options, totalMinor);
  const blocked = !bankAccountId || split.appliedMinor > totalMinor || split.overInvoice !== null;

  const submit = () => {
    if (blocked) return;
    const allocations = split.allocations();
    post.mutate({ bankAccountId, ...(allocations.length ? { allocations } : {}) }, { onSuccess: onClose });
  };

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t('title')}
      size="lg"
      dirty={chosenBank !== '' || split.manual}
      busy={post.isPending}
    >
      <FormDialogBody className="space-y-5">
        {post.isError ? (
          <Alert variant="error" messages={[post.error instanceof ApiError ? post.error.message : t('failed')]} />
        ) : null}

        <FormField htmlFor="post-bank" label={t('bankLabel')}>
          {receivingBanks.length === 0 && !bankAccounts.isPending ? (
            <Alert variant="warning" messages={[t('noBanks')]} />
          ) : (
            <Select id="post-bank" value={bankAccountId} onChange={setChosenBank}>
              <option value="">{t('bankPlaceholder')}</option>
              {receivingBanks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bankAccountLabel(bank)}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <section aria-labelledby="post-apply" className="space-y-3">
          <h3 id="post-apply" className="text-body-sm font-semibold text-foreground">
            {t('applyTitle')}
          </h3>
          <ApplyInvoicesTable options={options} split={split} amountMinor={totalMinor} amountLabel={tApply('received')} />
        </section>
      </FormDialogBody>

      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={post.isPending}>
            {tCommon('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="button" onClick={submit} loading={post.isPending} loadingText={t('posting')} disabled={blocked}>
          {t('post')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
