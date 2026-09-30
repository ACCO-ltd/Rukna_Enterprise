'use client';

import { useMemo, useState } from 'react';
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
  Input,
  MoneyDisplay,
  MoneyInput,
  Select,
} from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import type { ClientReceivableView } from '../lib/collection-view-model';
import { useProjectDepositAccounts, useRecordProjectPayment } from '../hooks/use-commercial';
import type { RecordProjectPaymentPayload } from '../api/commercial-api';
import {
  allocationPayload,
  checkAllocations,
  payableInvoices,
  prefillAllocations,
} from './record-payment-dialog.model';

export interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  currency: string;
  /** The invoice the user started from — listed first and its balance pre-fills the amount. */
  preselectedInvoice: ClientReceivableView | null;
  /** The project's invoices; those with a balance and `canRecordPayment` can take the receipt. */
  allInvoices: ClientReceivableView[];
}

const today = () => new Date().toISOString().slice(0, 10);

function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `rp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Record a client payment (decision D9: a Dialog) — a `FormDialog` (ADR-039), size `lg`.
 *
 * The receipt is applied to invoices OLDEST DUE FIRST (the invoice the user started from goes
 * first), pre-filled and editable per line. Whatever is received but not applied stays on the
 * client's account as credit, and the dialog says so; applying more than was received, or more
 * than an invoice's balance, is stopped with an inline reason.
 *
 * One idempotency key per opening: a retry after a network failure cannot record the receipt
 * twice (the API de-duplicates on it).
 */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  projectId,
  currency,
  preselectedInvoice,
  allInvoices,
}: RecordPaymentDialogProps) {
  const t = useTranslations('commercial.recordPayment');
  const locale = useLocale() as 'en';

  const invoices = useMemo(
    () => payableInvoices(allInvoices, preselectedInvoice?.invoiceId),
    [allInvoices, preselectedInvoice?.invoiceId],
  );
  const moneyHidden = allInvoices.some(
    (invoice) => invoice.canRecordPayment && invoice.outstanding === null,
  );

  const initialAmount = () => {
    const first = invoices[0];
    return preselectedInvoice && first && first.invoiceId === preselectedInvoice.invoiceId
      ? first.outstanding
      : '';
  };

  // What the dialog opened with — captured once (and again on reset), so a refetch of the
  // invoices behind it cannot make an untouched form look edited.
  const snapshot = () => {
    const amount = initialAmount();
    return {
      amount,
      date: today(),
      amounts: prefillAllocations(parseMinorUnits(amount, MONEY_SCALE) ?? 0, invoices),
    };
  };
  const [opening, setOpening] = useState(snapshot);

  const [bankAccountId, setBankAccountId] = useState('');
  const [amount, setAmount] = useState(opening.amount);
  const [date, setDate] = useState(opening.date);
  const [reference, setReference] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>(opening.amounts);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [attempted, setAttempted] = useState(false);

  const depositAccounts = useProjectDepositAccounts(projectId);
  const mutation = useRecordProjectPayment(projectId);

  const check = checkAllocations(amount, invoices, amounts);

  function reset() {
    const next = snapshot();
    setOpening(next);
    setBankAccountId('');
    setAmount(next.amount);
    setDate(next.date);
    setReference('');
    setAmounts(next.amounts);
    setIdempotencyKey(newIdempotencyKey());
    setAttempted(false);
    mutation.reset();
  }

  // Reached only once the FormDialog guard lets a dismissal through (not busy; dirty confirmed).
  function handleOpenChange(next: boolean) {
    if (!next && mutation.isPending) return;
    if (!next) reset();
    onOpenChange(next);
  }

  // Unsaved edits: anything the user has typed or picked beyond what the dialog opened with.
  const lineKeys = new Set([...Object.keys(amounts), ...Object.keys(opening.amounts)]);
  const dirty =
    !moneyHidden &&
    (bankAccountId !== '' ||
      amount !== opening.amount ||
      date !== opening.date ||
      reference !== '' ||
      [...lineKeys].some((key) => (amounts[key] ?? '') !== (opening.amounts[key] ?? '')));

  function handleAmountChange(next: string) {
    setAmount(next);
    // A new received amount gets a fresh oldest-first split; edits made for the old amount
    // would silently misapply the new one.
    const received = parseMinorUnits(next, MONEY_SCALE) ?? 0;
    setAmounts(prefillAllocations(received, invoices));
  }

  const missingAccount = bankAccountId === '';
  const canSubmit = check.valid && !missingAccount && date !== '' && !moneyHidden;

  function submit() {
    setAttempted(true);
    if (!canSubmit || check.receivedMinor === null) return;
    // `idempotencyKey` is accepted by the API DTO; the shared payload type predates it.
    const payload: RecordProjectPaymentPayload & { idempotencyKey: string } = {
      bankAccountId,
      receiptDate: date,
      amount: fromMinorUnits(check.receivedMinor, MONEY_SCALE),
      currency,
      reference: reference.trim() || undefined,
      allocations: allocationPayload(invoices, amounts),
      idempotencyKey,
    };
    mutation.mutate(payload, {
      onSuccess: () => {
        reset();
        onOpenChange(false);
      },
    });
  }

  const money = (minor: number) => <MoneyDisplay value={fromMinorUnits(minor, MONEY_SCALE)} />;

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('title')}
      subtitle={t('description')}
      size="lg"
      dirty={dirty}
      busy={mutation.isPending}
    >
      <FormDialogBody>
        {moneyHidden ? (
          <p className="text-body-sm text-muted-foreground">{t('moneyHidden')}</p>
        ) : (
          <div className="space-y-5">
            {mutation.isError ? (
              <Alert variant="error" messages={[mutation.error.message || t('failed')]} />
            ) : null}

            <FormField
              htmlFor="rp-account"
              label={t('account')}
              error={attempted && missingAccount ? t('accountRequired') : undefined}
            >
              <Select
                id="rp-account"
                value={bankAccountId}
                onChange={setBankAccountId}
                disabled={mutation.isPending}
                required
              >
                <option value="">
                  {depositAccounts.isPending ? t('accountLoading') : t('accountPlaceholder')}
                </option>
                {(depositAccounts.data ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bankName} · {account.accountName} · {account.accountNumber}
                  </option>
                ))}
              </Select>
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                htmlFor="rp-amount"
                label={t('amount')}
                error={
                  attempted && (check.receivedMinor === null || check.receivedMinor <= 0)
                    ? t('amountRequired')
                    : undefined
                }
              >
                <MoneyInput
                  id="rp-amount"
                  value={amount}
                  onValueChange={handleAmountChange}
                  disabled={mutation.isPending}
                  required
                />
              </FormField>
              <FormField htmlFor="rp-date" label={t('date')}>
                <DatePicker id="rp-date" value={date} onChange={setDate} max={today()} />
              </FormField>
            </div>

            <FormField htmlFor="rp-reference" label={t('reference')} hint={t('referenceHint')}>
              <Input
                id="rp-reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                disabled={mutation.isPending}
              />
            </FormField>

            <section aria-labelledby="rp-apply-title" className="space-y-3">
              <div>
                <h3 id="rp-apply-title" className="text-body-sm font-semibold text-foreground">
                  {t('applyTitle')}
                </h3>
                <p className="text-caption text-muted-foreground">{t('applyHint')}</p>
              </div>

              {invoices.length === 0 ? (
                <p className="text-body-sm text-muted-foreground">{t('noOpenInvoices')}</p>
              ) : (
                <ul className="divide-y divide-border rounded-panel border border-border">
                  {invoices.map((invoice) => {
                    const lineError = check.lineErrors[invoice.invoiceId];
                    const inputId = `rp-line-${invoice.invoiceId}`;
                    return (
                      <li key={invoice.invoiceId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <label htmlFor={inputId} className="block text-body-sm font-medium text-foreground">
                            {invoice.invoiceNumber ?? t('unnumbered')}
                          </label>
                          <p className="truncate text-caption text-muted-foreground">{invoice.sourceLabel}</p>
                          <p className="text-caption text-muted-foreground">
                            {t('balance')} <MoneyDisplay value={invoice.outstanding} />
                            {invoice.dueDate
                              ? ` · ${t('due', { date: formatDate(invoice.dueDate, locale) ?? invoice.dueDate })}`
                              : null}
                          </p>
                        </div>
                        <div className="w-full sm:w-40 sm:shrink-0">
                          <MoneyInput
                            id={inputId}
                            value={amounts[invoice.invoiceId] ?? ''}
                            onValueChange={(value) =>
                              setAmounts((prev) => ({ ...prev, [invoice.invoiceId]: value }))
                            }
                            aria-invalid={Boolean(lineError)}
                            aria-describedby={lineError ? `${inputId}-error` : undefined}
                            disabled={mutation.isPending}
                            className="text-end"
                          />
                          {lineError ? (
                            <p id={`${inputId}-error`} role="alert" className="mt-1 text-caption text-danger">
                              {lineError === 'OVER_BALANCE' ? t('overBalance') : t('invalidAmount')}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <dl className="space-y-1 text-body-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">{t('applied')}</dt>
                  <dd className="font-medium text-foreground">{money(check.appliedMinor)}</dd>
                </div>
              </dl>

              {check.overApplied ? (
                <p role="alert" className="text-body-sm text-danger">
                  {t('overApplied')}
                </p>
              ) : check.unappliedMinor > 0 ? (
                <p className="text-body-sm text-muted-foreground">
                  {t('unapplied', {
                    amount:
                      formatMoney(fromMinorUnits(check.unappliedMinor, MONEY_SCALE), currency, locale) ?? '',
                  })}
                </p>
              ) : null}
            </section>
          </div>
        )}
      </FormDialogBody>

      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={mutation.isPending}>
            {t('cancel')}
          </Button>
        </FormDialogClose>
        {moneyHidden ? null : (
          <Button type="button" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? t('saving') : t('submit')}
          </Button>
        )}
      </FormDialogFooter>
    </FormDialog>
  );
}
