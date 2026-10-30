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
  DatePicker,
  FormField,
  Select,
} from '@erp/ui';

import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { useInvoices } from '@/features/accounting/hooks/use-invoices';
import { bankAccountLabel } from '@/features/procurement/payment-actions';
import { ApiError } from '@/lib/api-client';
import { todayWireDate } from '@/features/accounting/invoice-overdue';
import { formatDate } from '@/lib/format';

import { invoicesForClient, toMinorUnits } from '../allocation';
import { usePostReceipt } from '../hooks/use-receipts';
import { ACCOUNT_KIND_FOR_METHOD, isPostDatedCheque, isReceiptPaymentMethod } from '../payment-methods';
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

  // PM-3 — only accounts of the kind the payment method lands in.
  const kind = isReceiptPaymentMethod(receipt.paymentMethod) ? ACCOUNT_KIND_FOR_METHOD[receipt.paymentMethod] : null;
  const receivingBanks = useMemo(
    () =>
      (bankAccounts.data ?? []).filter(
        (b) => b.status === 'ACTIVE' && b.allowsReceipts && (!kind || (b.kind ?? 'BANK') === kind),
      ),
    [bankAccounts.data, kind],
  );
  const [chosenBank, setChosenBank] = useState('');
  // A cheque on hand already names the account it is banked into.
  const savedBank = receivingBanks.find((b) => b.id === receipt.bankAccountId)?.id;
  const bankAccountId = chosenBank || savedBank || (receivingBanks.length === 1 ? receivingBanks[0]!.id : '');

  // PM-4 — a cheque on hand is deposited: it posts on the deposit day, never before its date.
  const onHand = isPostDatedCheque(receipt.paymentMethod, receipt.instrumentDate, receipt.receiptDate);
  const chequeDate = receipt.instrumentDate?.slice(0, 10) ?? '';
  const [depositDate, setDepositDate] = useState(() => {
    const today = todayWireDate();
    return onHand && chequeDate > today ? chequeDate : today;
  });
  const tooEarly = onHand && depositDate < chequeDate;

  const options = useMemo(() => invoicesForClient(invoices.data ?? [], receipt.clientId), [invoices.data, receipt.clientId]);
  const totalMinor = toMinorUnits(receipt.totalAmount);
  const split = useApplySplit(options, totalMinor);
  const blocked = !bankAccountId || tooEarly || split.appliedMinor > totalMinor || split.overInvoice !== null;

  const submit = () => {
    if (blocked) return;
    const allocations = split.allocations();
    post.mutate(
      { bankAccountId, ...(onHand ? { depositDate } : {}), ...(allocations.length ? { allocations } : {}) },
      { onSuccess: onClose },
    );
  };

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={onHand ? t('depositTitle') : t('title')}
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

        {onHand ? (
          <FormField
            htmlFor="post-deposit-date"
            label={t('depositDate')}
            hint={t('chequeDated', { date: formatDate(chequeDate) ?? chequeDate })}
            error={tooEarly ? t('chequeDated', { date: formatDate(chequeDate) ?? chequeDate }) : undefined}
            className="max-w-xs"
          >
            <DatePicker id="post-deposit-date" value={depositDate} onChange={setDepositDate} />
          </FormField>
        ) : null}

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
          {onHand ? t('deposit') : t('post')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
