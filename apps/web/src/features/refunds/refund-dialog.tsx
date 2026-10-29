'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DatePicker,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Input,
  MoneyDisplay,
  MoneyInput,
  Notice,
  Select,
  Textarea,
} from '@erp/ui';

import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits, toMinorUnits } from '@/lib/money';

import { useRequestRefund } from './refunds';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * AR-5 — pay back cash a receipt holds on account (an overpayment, a cancelled job). Money leaves
 * the bank, so it follows the payment rule: up to the payment limit it posts at once; above it a
 * second person approves. A `FormDialog` (ADR-039).
 */
export function RefundDialog({
  open,
  onOpenChange,
  receiptId,
  onAccount,
  currencyCode,
  approvedUpTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receiptId: string;
  /** What the receipt holds on account (decimal string). */
  onAccount: string;
  currencyCode: string;
  /** The organisation's payment limit; null while loading. "0.00" = every refund needs approval. */
  approvedUpTo: string | null;
}) {
  const t = useTranslations('platform.receipts.refund');
  const banks = useBankAccounts();
  const mutation = useRequestRefund(receiptId);
  const payingBanks = useMemo(
    () => (banks.data ?? []).filter((b) => b.status === 'ACTIVE' && b.allowsPayments && b.currencyCode === currencyCode),
    [banks.data, currencyCode],
  );
  const [bankAccountId, setBankAccountId] = useState('');
  const [amount, setAmount] = useState(onAccount);
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [attempted, setAttempted] = useState(false);

  const reset = () => {
    setBankAccountId('');
    setAmount(onAccount);
    setDate(today());
    setReason('');
    setReference('');
    setAttempted(false);
    mutation.reset();
  };
  const handleOpenChange = (next: boolean) => {
    if (!next && mutation.isPending) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const minor = parseMinorUnits(amount, MONEY_SCALE);
  const max = toMinorUnits(onAccount, MONEY_SCALE);
  const errors = {
    bank: attempted && !bankAccountId ? t('bankRequired') : undefined,
    amount:
      attempted && (minor === null || minor <= 0) ? t('amountRequired') : minor !== null && minor > max ? t('amountOverOnAccount') : undefined,
    reason: attempted && reason.trim().length < 3 ? t('reasonRequired') : undefined,
  };
  const needsApproval =
    approvedUpTo !== null && minor !== null && (Number(approvedUpTo) === 0 || minor > toMinorUnits(approvedUpTo, MONEY_SCALE));

  function submit() {
    setAttempted(true);
    if (!bankAccountId || minor === null || minor <= 0 || minor > max || reason.trim().length < 3) return;
    mutation.mutate(
      { bankAccountId, amount: fromMinorUnits(minor, MONEY_SCALE), refundDate: date, reason: reason.trim(), reference: reference.trim() || undefined },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <FormDialog open={open} onOpenChange={handleOpenChange} title={t('title')} size="md" dirty={Boolean(bankAccountId || reason || reference) || amount !== onAccount} busy={mutation.isPending}>
      <FormDialogBody>
        {mutation.isError ? <Alert variant="error" messages={[mutation.error instanceof ApiError ? mutation.error.message : t('failed')]} /> : null}
        <p className="text-body-sm text-muted-foreground">
          {t('onAccount')} <MoneyDisplay value={onAccount} className="font-medium text-foreground" />
        </p>
        <FormField htmlFor="refund-bank" label={t('bank')} error={errors.bank}>
          <Select id="refund-bank" value={bankAccountId} onChange={setBankAccountId} placeholder={t('bankPlaceholder')}>
            <option value="">{t('bankPlaceholder')}</option>
            {payingBanks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.bankName} · {b.accountName}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField htmlFor="refund-amount" label={t('amount')} error={errors.amount}>
          <MoneyInput id="refund-amount" value={amount} onValueChange={setAmount} required />
        </FormField>
        <FormField htmlFor="refund-date" label={t('date')}>
          <DatePicker id="refund-date" value={date} onChange={setDate} />
        </FormField>
        <FormField htmlFor="refund-reference" label={t('reference')}>
          <Input id="refund-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
        </FormField>
        <FormField htmlFor="refund-reason" label={t('reason')} error={errors.reason}>
          <Textarea id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </FormField>
        {needsApproval ? (
          <Notice tone="attention" title={t('approvalTitle')}>
            {t('approvalBody', { limit: formatMoney(approvedUpTo, currencyCode) ?? approvedUpTo })}
          </Notice>
        ) : (
          <p className="text-caption text-muted-foreground">{t('postsNow')}</p>
        )}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={mutation.isPending}>
            {t('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="button" onClick={submit} loading={mutation.isPending}>
          {needsApproval ? t('submitForApproval') : t('submit')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
