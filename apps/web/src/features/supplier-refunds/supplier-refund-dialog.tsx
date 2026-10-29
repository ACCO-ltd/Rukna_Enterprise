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
  Select,
  Textarea,
} from '@erp/ui';

import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { ApiError } from '@/lib/api-client';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits, toMinorUnits } from '@/lib/money';

import { useRecordSupplierRefund } from './supplier-refunds';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * AP-5 — record money the supplier paid back from what this payment holds unapplied (an order
 * cancelled, an overpayment). Money comes in, so it posts at once. A `FormDialog` (ADR-039).
 */
export function SupplierRefundDialog({
  open,
  onOpenChange,
  paymentId,
  unapplied,
  currencyCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  /** What the payment still holds unapplied (decimal string). */
  unapplied: string;
  currencyCode: string;
}) {
  const t = useTranslations('procurement.supplierRefund');
  const mutation = useRecordSupplierRefund(paymentId);
  const banks = useBankAccounts();
  const receivingBanks = useMemo(
    () => (banks.data ?? []).filter((b) => b.status === 'ACTIVE' && b.allowsReceipts && b.currencyCode === currencyCode),
    [banks.data, currencyCode],
  );
  const [bankAccountId, setBankAccountId] = useState('');
  const [amount, setAmount] = useState(unapplied);
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [attempted, setAttempted] = useState(false);

  const reset = () => {
    setBankAccountId('');
    setAmount(unapplied);
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
  const max = toMinorUnits(unapplied, MONEY_SCALE);
  const errors = {
    bank: attempted && !bankAccountId ? t('bankRequired') : undefined,
    amount:
      attempted && (minor === null || minor <= 0)
        ? t('amountRequired')
        : minor !== null && minor > max
          ? t('amountOverUnapplied')
          : undefined,
    reason: attempted && !reason.trim() ? t('reasonRequired') : undefined,
  };

  function submit() {
    setAttempted(true);
    if (!bankAccountId || minor === null || minor <= 0 || minor > max || !reason.trim()) return;
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
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('title')}
      size="md"
      dirty={Boolean(bankAccountId || reason || reference) || amount !== unapplied}
      busy={mutation.isPending}
    >
      <FormDialogBody>
        {mutation.isError ? (
          <Alert variant="error" messages={[mutation.error instanceof ApiError ? mutation.error.message : t('failed')]} />
        ) : null}
        <p className="text-body-sm text-muted-foreground">
          {t('unapplied')} <MoneyDisplay value={unapplied} className="font-medium text-foreground" />
        </p>
        <FormField htmlFor="sr-bank" label={t('bank')} error={errors.bank} required>
          <Select id="sr-bank" value={bankAccountId} onChange={setBankAccountId} placeholder={t('bankPlaceholder')}>
            <option value="">{t('bankPlaceholder')}</option>
            {receivingBanks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.bankName} · {b.accountName}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField htmlFor="sr-amount" label={t('amount')} error={errors.amount} required>
          <MoneyInput id="sr-amount" value={amount} onValueChange={setAmount} required />
        </FormField>
        <FormField htmlFor="sr-reason" label={t('reason')} error={errors.reason} hint={t('reasonHint')} required>
          <Textarea id="sr-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
        </FormField>
        <FormField htmlFor="sr-reference" label={t('reference')}>
          <Input id="sr-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
        </FormField>
        <FormField htmlFor="sr-date" label={t('date')}>
          <DatePicker id="sr-date" value={date} onChange={setDate} />
        </FormField>
        <p className="text-caption text-muted-foreground">{t('postsNow')}</p>
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={mutation.isPending}>
            {t('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="button" onClick={submit} loading={mutation.isPending}>
          {t('submit')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
