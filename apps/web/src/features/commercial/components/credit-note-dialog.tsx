'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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
  RadioGroup,
  Textarea,
  type RadioOption,
} from '@erp/ui';

import { formatDate } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import type { CreditNoteReason } from '../api/commercial-invoice-api';
import { useIssueCreditNote } from '../hooks/use-commercial-invoice';

export interface CreditNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  /** The invoice's balance due; null when hidden. Shown for context — the server enforces it. */
  balanceDue: string | null;
  onIssued?: (creditNoteNumber: string | null) => void;
}

const REASONS: CreditNoteReason[] = ['CORRECTION', 'PRICE_ERROR', 'OMISSION'];
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Issue a credit note against an issued invoice — the only way to correct it once it is
 * numbered and posted. Create + post in one go: the note is numbered, journalled, and the
 * invoice balance falls by the amount plus sales tax at the invoice's own rate (applied by the
 * server; this dialog knows no rate). If posting fails after the note was created, a retry posts
 * that same note rather than raising a second one.
 *
 * A `FormDialog` (ADR-039), size `md`.
 */
export function CreditNoteDialog({
  open,
  onOpenChange,
  projectId,
  invoiceId,
  invoiceNumber,
  balanceDue,
  onIssued,
}: CreditNoteDialogProps) {
  const t = useTranslations('commercial.creditNote');
  const locale = useLocale() as 'en';
  const mutation = useIssueCreditNote(projectId, invoiceId);

  const [reason, setReason] = useState<CreditNoteReason | ''>('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  function reset() {
    setReason('');
    setAmount('');
    setDate(today());
    setNote('');
    setAttempted(false);
    setCreatedId(null);
    mutation.reset();
  }

  function handleOpenChange(next: boolean) {
    if (!next && mutation.isPending) return;
    if (!next) reset();
    onOpenChange(next);
  }

  const dirty = reason !== '' || amount !== '' || date !== today() || note !== '' || createdId !== null;

  const amountMinor = parseMinorUnits(amount, MONEY_SCALE);
  const amountError =
    attempted && (amountMinor === null || amountMinor <= 0) ? t('amountRequired') : undefined;
  const reasonError = attempted && !reason ? t('reasonRequired') : undefined;

  function submit() {
    setAttempted(true);
    if (!reason || amountMinor === null || amountMinor <= 0 || !date) return;
    mutation.mutate(
      {
        existingId: createdId,
        payload: {
          reason,
          netAmount: fromMinorUnits(amountMinor, MONEY_SCALE),
          accountingDate: date,
          note: note.trim() || undefined,
        },
      },
      {
        onSuccess: (result) => {
          reset();
          onOpenChange(false);
          onIssued?.(result.creditNoteNumber);
        },
        onError: (error) => {
          if (error.creditNoteId) setCreatedId(error.creditNoteId);
        },
      },
    );
  }

  const options: RadioOption<CreditNoteReason>[] = REASONS.map((value) => ({
    value,
    label: t(`reason.${value}`),
  }));

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('title')}
      subtitle={invoiceNumber ? t('description', { number: invoiceNumber }) : t('descriptionNoNumber')}
      size="md"
      dirty={dirty}
      // A note created but not posted is not "unsaved changes" — it exists as a draft. Say so.
      discardLabels={
        createdId
          ? {
              title: t('unposted.title'),
              description: t('unposted.description'),
              confirm: t('unposted.confirm'),
              cancel: t('unposted.cancel'),
            }
          : undefined
      }
      busy={mutation.isPending}
    >
      <FormDialogBody>
        {mutation.isError ? (
          <Alert
            variant="error"
            messages={[
              createdId ? t('postFailed') : mutation.error.message || t('failed'),
            ]}
          />
        ) : null}

        {balanceDue !== null ? (
          <p className="text-body-sm text-muted-foreground">
            {t('balance')} <MoneyDisplay value={balanceDue} className="font-medium text-foreground" />
          </p>
        ) : null}

        <RadioGroup
          label={t('reasonLabel')}
          name="credit-note-reason"
          value={reason}
          onChange={(value) => setReason(value)}
          options={options}
          orientation="vertical"
          required
          description={reasonError}
        />

        <FormField htmlFor="cn-amount" label={t('amount')} hint={t('amountHint')} error={amountError}>
          <MoneyInput
            id="cn-amount"
            value={amount}
            onValueChange={setAmount}
            disabled={mutation.isPending || createdId !== null}
            required
          />
        </FormField>

        <FormField htmlFor="cn-date" label={t('date')}>
          <DatePicker id="cn-date" value={date} onChange={setDate} />
        </FormField>

        <FormField htmlFor="cn-note" label={t('note')}>
          <Textarea
            id="cn-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            disabled={mutation.isPending || createdId !== null}
          />
        </FormField>

        <p className="text-caption text-muted-foreground">
          {t('consequence', { date: formatDate(date, locale) ?? date })}
        </p>
      </FormDialogBody>

      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={mutation.isPending}>
            {t('cancel')}
          </Button>
        </FormDialogClose>
        <Button type="button" onClick={submit} disabled={mutation.isPending}>
          {mutation.isPending ? t('issuing') : createdId ? t('retryPost') : t('submit')}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
