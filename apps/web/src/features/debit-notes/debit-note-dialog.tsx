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
  Input,
  MoneyDisplay,
  MoneyInput,
  Textarea,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits, toMinorUnits } from '@/lib/money';

import { useRecordDebitNote } from './debit-notes';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * AP-4 — record a credit the supplier gave against this bill: goods sent back, an overcharge, a
 * discount agreed later. Posts at once (no money moves) and lowers what is left to pay; the cost
 * comes off the bill's own cost lines and project. A `FormDialog` (ADR-039).
 */
export function DebitNoteDialog({
  open,
  onOpenChange,
  billId,
  leftToPay,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billId: string;
  /** What is still left to pay on the bill (decimal string). */
  leftToPay: string;
}) {
  const t = useTranslations('procurement.debitNote');
  const mutation = useRecordDebitNote(billId);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [attempted, setAttempted] = useState(false);

  const reset = () => {
    setAmount('');
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
  const leftMinor = toMinorUnits(leftToPay, MONEY_SCALE);
  const amountError =
    attempted && (minor === null || minor <= 0)
      ? t('amountRequired')
      : minor !== null && minor > leftMinor
        ? t('amountOverBalance')
        : undefined;
  const reasonError = attempted && !reason.trim() ? t('reasonRequired') : undefined;

  function submit() {
    setAttempted(true);
    if (!reason.trim() || minor === null || minor <= 0 || minor > leftMinor) return;
    mutation.mutate(
      { amount: fromMinorUnits(minor, MONEY_SCALE), accountingDate: date, reason: reason.trim(), supplierReference: reference.trim() || undefined },
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
      dirty={amount !== '' || reason !== '' || reference !== ''}
      busy={mutation.isPending}
    >
      <FormDialogBody>
        {mutation.isError ? (
          <Alert variant="error" messages={[mutation.error instanceof ApiError ? mutation.error.message : t('failed')]} />
        ) : null}
        <p className="text-body-sm text-muted-foreground">
          {t('leftToPay')} <MoneyDisplay value={leftToPay} className="font-medium text-foreground" />
        </p>
        <FormField htmlFor="dn-amount" label={t('amount')} error={amountError} required>
          <MoneyInput id="dn-amount" value={amount} onValueChange={setAmount} required />
        </FormField>
        <FormField htmlFor="dn-reason" label={t('reason')} error={reasonError} hint={t('reasonHint')} required>
          <Textarea id="dn-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
        </FormField>
        <FormField htmlFor="dn-reference" label={t('reference')} hint={t('referenceHint')}>
          <Input id="dn-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
        </FormField>
        <FormField htmlFor="dn-date" label={t('date')}>
          <DatePicker id="dn-date" value={date} onChange={setDate} />
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
