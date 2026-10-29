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
  MoneyInput,
  Notice,
  Select,
} from '@erp/ui';

import { useApprovalSettings, useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits, toMinorUnits } from '@/lib/money';

import { useRequestTransfer } from './transfers-api';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * B-2 — move money between two of the organisation's own accounts. Up to the payment limit it
 * posts at once; above it, it waits for a second person — the dialog says which before sending.
 * A `FormDialog` (ADR-039).
 */
export function TransferDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('finance.transfers');
  const banks = useBankAccounts();
  const settings = useApprovalSettings();
  const mutation = useRequestTransfer();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [attempted, setAttempted] = useState(false);

  const active = useMemo(() => (banks.data ?? []).filter((b) => b.status === 'ACTIVE'), [banks.data]);
  const senders = active.filter((b) => b.allowsPayments);
  const sender = active.find((b) => b.id === from);
  const receivers = active.filter((b) => b.allowsReceipts && b.id !== from && (!sender || b.currencyCode === sender.currencyCode));

  const reset = () => {
    setFrom(''); setTo(''); setAmount(''); setDate(today()); setReference(''); setMemo(''); setAttempted(false);
    mutation.reset();
  };
  const handleOpenChange = (next: boolean) => {
    if (!next && mutation.isPending) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const minor = parseMinorUnits(amount, MONEY_SCALE);
  const limit = settings.data?.paymentAutoApproveUpTo ?? null;
  const goesToApproval = limit !== null && minor !== null && minor > toMinorUnits(limit, MONEY_SCALE);
  const errors = {
    from: attempted && !from ? t('fromRequired') : undefined,
    to: attempted && !to ? t('toRequired') : undefined,
    amount: attempted && (minor === null || minor <= 0) ? t('amountRequired') : undefined,
  };

  function submit() {
    setAttempted(true);
    if (!from || !to || minor === null || minor <= 0) return;
    mutation.mutate(
      { fromBankAccountId: from, toBankAccountId: to, amount: fromMinorUnits(minor, MONEY_SCALE), transferDate: date, reference: reference.trim() || undefined, memo: memo.trim() || undefined },
      { onSuccess: () => { reset(); onOpenChange(false); } },
    );
  }

  return (
    <FormDialog open={open} onOpenChange={handleOpenChange} title={t('newTitle')} size="md" dirty={Boolean(from || to || amount || reference || memo)} busy={mutation.isPending}>
      <FormDialogBody>
        {mutation.isError ? <Alert variant="error" messages={[mutation.error instanceof ApiError ? mutation.error.message : t('failed')]} /> : null}
        <FormField htmlFor="tr-from" label={t('from')} error={errors.from} required>
          <Select id="tr-from" value={from} onChange={(v) => { setFrom(v); if (v === to) setTo(''); }} placeholder={t('pick')}>
            <option value="">{t('pick')}</option>
            {senders.map((b) => (
              <option key={b.id} value={b.id}>{b.bankName} · {b.accountName}{b.bookBalance ? ` (${formatMoney(b.bookBalance, b.currencyCode) ?? b.bookBalance})` : ''}</option>
            ))}
          </Select>
        </FormField>
        <FormField htmlFor="tr-to" label={t('to')} error={errors.to} required>
          <Select id="tr-to" value={to} onChange={setTo} placeholder={t('pick')}>
            <option value="">{t('pick')}</option>
            {receivers.map((b) => (
              <option key={b.id} value={b.id}>{b.bankName} · {b.accountName}</option>
            ))}
          </Select>
        </FormField>
        <FormField htmlFor="tr-amount" label={t('amount')} error={errors.amount} required>
          <MoneyInput id="tr-amount" value={amount} onValueChange={setAmount} required />
        </FormField>
        <FormField htmlFor="tr-date" label={t('date')}>
          <DatePicker id="tr-date" value={date} onChange={setDate} />
        </FormField>
        <FormField htmlFor="tr-memo" label={t('memo')} hint={t('memoHint')}>
          <Input id="tr-memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} />
        </FormField>
        <FormField htmlFor="tr-ref" label={t('reference')}>
          <Input id="tr-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
        </FormField>
        {goesToApproval ? (
          <Notice tone="attention" title={t('approvalTitle')}>{t('approvalBody', { limit: formatMoney(limit, 'USD') ?? limit })}</Notice>
        ) : (
          <p className="text-caption text-muted-foreground">{t('postsNow')}</p>
        )}
      </FormDialogBody>
      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={mutation.isPending}>{t('cancel')}</Button>
        </FormDialogClose>
        <Button type="button" onClick={submit} loading={mutation.isPending}>{goesToApproval ? t('submitForApproval') : t('submit')}</Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
