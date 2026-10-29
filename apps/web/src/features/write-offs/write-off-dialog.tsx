'use client';

import { useState } from 'react';
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
  MoneyDisplay,
  MoneyInput,
  Notice,
  RadioGroup,
  Textarea,
  type RadioOption,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits, toMinorUnits } from '@/lib/money';

import { useRequestWriteOff } from './hooks';

type Reason = 'SMALL_BALANCE' | 'BAD_DEBT';
const today = () => new Date().toISOString().slice(0, 10);

/**
 * AR-4 — write off part or all of an invoice's balance (owner decision 2026-10-29). Up to the
 * organisation's limit it posts at once; above it, it goes to Approvals and a second person
 * decides. Says which before it is sent. A `FormDialog` (ADR-039).
 */
export function WriteOffDialog({
  open,
  onOpenChange,
  invoiceId,
  balance,
  approvalAbove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  /** What the invoice still owes (decimal string). */
  balance: string;
  /** The organisation's limit (decimal string); null while loading. */
  approvalAbove: string | null;
}) {
  const t = useTranslations('accounting.writeOff');
  const mutation = useRequestWriteOff(invoiceId);
  const [reason, setReason] = useState<Reason | ''>('');
  const [amount, setAmount] = useState(balance);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);

  const reset = () => {
    setReason('');
    setAmount(balance);
    setDate(today());
    setNote('');
    setAttempted(false);
    mutation.reset();
  };
  const handleOpenChange = (next: boolean) => {
    if (!next && mutation.isPending) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const minor = parseMinorUnits(amount, MONEY_SCALE);
  const balanceMinor = toMinorUnits(balance, MONEY_SCALE);
  const amountError =
    attempted && (minor === null || minor <= 0)
      ? t('amountRequired')
      : minor !== null && minor > balanceMinor
        ? t('amountOverBalance')
        : undefined;
  const reasonError = attempted && !reason ? t('reasonRequired') : undefined;
  const goesToApproval = approvalAbove !== null && minor !== null && minor > toMinorUnits(approvalAbove, MONEY_SCALE);

  function submit() {
    setAttempted(true);
    if (!reason || minor === null || minor <= 0 || minor > balanceMinor) return;
    mutation.mutate(
      { reason, amount: fromMinorUnits(minor, MONEY_SCALE), accountingDate: date, note: note.trim() || undefined },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  }

  const options: RadioOption<Reason>[] = (['SMALL_BALANCE', 'BAD_DEBT'] as const).map((value) => ({
    value,
    label: t(`reason.${value}`),
    description: t(`reasonHint.${value}`),
  }));

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('title')}
      size="md"
      dirty={reason !== '' || amount !== balance || note !== ''}
      busy={mutation.isPending}
    >
      <FormDialogBody>
        {mutation.isError ? (
          <Alert variant="error" messages={[mutation.error instanceof ApiError ? mutation.error.message : t('failed')]} />
        ) : null}
        <p className="text-body-sm text-muted-foreground">
          {t('balance')} <MoneyDisplay value={balance} className="font-medium text-foreground" />
        </p>
        <RadioGroup
          label={t('reasonLabel')}
          name="write-off-reason"
          value={reason}
          onChange={setReason}
          options={options}
          orientation="vertical"
          required
          description={reasonError}
        />
        <FormField htmlFor="wo-amount" label={t('amount')} error={amountError}>
          <MoneyInput id="wo-amount" value={amount} onValueChange={setAmount} required />
        </FormField>
        <FormField htmlFor="wo-date" label={t('date')}>
          <DatePicker id="wo-date" value={date} onChange={setDate} />
        </FormField>
        <FormField htmlFor="wo-note" label={t('note')}>
          <Textarea id="wo-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </FormField>
        {goesToApproval ? (
          <Notice tone="attention" title={t('approvalTitle')}>
            {t('approvalBody', { limit: formatMoney(approvalAbove, 'USD') ?? approvalAbove })}
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
          {goesToApproval ? t('submitForApproval') : t('submit')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
