'use client';

import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert, Button, DatePicker, FormField, Input, MoneyInput, Select } from '@erp/ui';

import { LoadError } from '@/components/load-error';
import { useModuleTrail } from '@/components/layout/module-chrome';
import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useBankAccounts } from '@/features/accounting/hooks/use-accounting';
import { useInvoices } from '@/features/accounting/hooks/use-invoices';
import { todayWireDate } from '@/features/accounting/invoice-overdue';
import { useClients } from '@/features/clients/hooks/use-clients';
import { toDecimalString } from '@/features/contracts/contract-form-payload';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { applyOldestFirst, fromMinorUnits, invoicesForClient, toMinorUnits } from '../allocation';
import { useCreateReceipt, useReceivePayment } from '../hooks/use-receipts';

interface ReceiptFormValues {
  clientId: string;
  bankAccountId: string;
  receiptDate: string;
  amount: string;
  reference: string;
  notes: string;
}

/**
 * Receive payment (ADR-046 §6): the money lands straight in the bank account it arrived in. With
 * `manage:receivable` the receipt is recorded, posted (Dr that bank) and applied to the client's
 * open invoices in one action, oldest due first unless the reader changes the split; whatever is
 * not applied stays unapplied on the client. Without it, the receipt is recorded for finance to
 * post, as before.
 */
export function ReceiptForm() {
  const t = useTranslations('platform.receipts.create');
  const tCommon = useTranslations('common');
  useModuleTrail(t('title'));

  const { can } = usePermissions();
  const mayPost = can(ACCOUNTING_PERMISSIONS.manageReceivables);
  const searchParams = useSearchParams();
  const create = useCreateReceipt();
  const receive = useReceivePayment();
  const clients = useClients();
  const banks = useBankAccounts();
  const invoices = useInvoices();

  const receivingBanks = (banks.data ?? []).filter((b) => b.status === 'ACTIVE' && b.allowsReceipts);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ReceiptFormValues>({
    defaultValues: {
      // "Record receipt from …" (⌘K) arrives with the client chosen.
      clientId: searchParams?.get('clientId') ?? '',
      bankAccountId: '',
      receiptDate: todayWireDate(),
      // "Record payment" on an invoice arrives with its balance as the amount.
      amount: searchParams?.get('amount') ?? '',
      reference: '',
      notes: '',
    },
  });
  const clientId = useWatch({ control, name: 'clientId' });
  const amount = useWatch({ control, name: 'amount' });

  const open = useMemo(() => (clientId ? invoicesForClient(invoices.data ?? [], clientId) : []), [clientId, invoices.data]);
  // The split follows the amount until the reader edits a line; then it is theirs.
  const [manual, setManual] = useState<Record<string, string> | null>(null);
  const amountMinor = Number.isFinite(Number(amount)) ? toMinorUnits(amount || '0') : 0;
  // From an invoice's "Record payment" the money goes to that invoice; otherwise oldest due first.
  const focusId = searchParams?.get('invoiceId') ?? null;
  const focus = focusId ? open.find((o) => o.invoice.id === focusId) : undefined;
  const suggested = focus
    ? new Map([[focus.invoice.id, Math.min(amountMinor, focus.outstandingMinor)]])
    : applyOldestFirst(amountMinor, open);
  const appliedFor = (id: string) =>
    manual ? toMinorUnits(manual[id] || '0') : (suggested.get(id) ?? 0);
  const appliedMinor = open.reduce((sum, o) => sum + appliedFor(o.invoice.id), 0);
  const leftMinor = amountMinor - appliedMinor;
  const overApplied = leftMinor < 0;
  const overInvoice = open.find((o) => appliedFor(o.invoice.id) > o.outstandingMinor);
  const money = (minor: number) => formatMoney(fromMinorUnits(minor), 'USD') ?? fromMinorUnits(minor);

  const onSubmit = (values: ReceiptFormValues) => {
    const base = {
      clientId: values.clientId,
      receiptDate: values.receiptDate,
      amount: toDecimalString(values.amount),
      // Single-currency platform (ADR-024): USD is implicit, never entered.
      currency: 'USD',
      ...(values.reference.trim() ? { reference: values.reference.trim() } : {}),
      ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
    };
    if (!mayPost) {
      create.mutate(base);
      return;
    }
    if (overApplied || overInvoice) return;
    receive.mutate({
      ...base,
      bankAccountId: values.bankAccountId,
      allocations: open
        .map((o) => ({ clientInvoiceId: o.invoice.id, amount: Number(fromMinorUnits(appliedFor(o.invoice.id))) }))
        .filter((a) => a.amount > 0),
    });
  };

  const failure = receive.error ?? create.error;
  const errorMessages = failure
    ? [failure instanceof ApiError && failure.messages.length > 0 ? failure.message : t('failed')]
    : [];
  const pending = receive.isPending || create.isPending;

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      className="space-y-5"
      noValidate
    >
      {errorMessages.length > 0 ? <Alert variant="error" messages={errorMessages} /> : null}
      {clients.isError ? <LoadError message={t('loadFailed')} onRetry={() => void clients.refetch()} /> : null}
      {mayPost && banks.isError ? <LoadError message={t('banksLoadFailed')} onRetry={() => void banks.refetch()} /> : null}

      <FormField htmlFor="receipt-client" label={t('client')} error={errors.clientId?.message}>
        <Controller
          control={control}
          name="clientId"
          rules={{ required: t('clientRequired') }}
          render={({ field }) => (
            <Select
              id="receipt-client"
              disabled={clients.isPending}
              value={field.value}
              onChange={(value) => {
                field.onChange(value);
                setManual(null);
              }}
            >
              <option value="">{clients.isPending ? tCommon('loading') : t('clientPlaceholder')}</option>
              {(clients.data ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.code} — {client.name}
                </option>
              ))}
            </Select>
          )}
        />
      </FormField>

      {mayPost ? (
        <FormField htmlFor="receipt-bank" label={t('bank')} hint={t('bankHint')} error={errors.bankAccountId?.message}>
          <Controller
            control={control}
            name="bankAccountId"
            rules={{ required: t('bankRequired') }}
            render={({ field }) => (
              <Select id="receipt-bank" disabled={banks.isPending} value={field.value} onChange={field.onChange}>
                <option value="">{banks.isPending ? tCommon('loading') : t('bankPlaceholder')}</option>
                {receivingBanks.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.bankName} — {bank.accountName}
                  </option>
                ))}
              </Select>
            )}
          />
        </FormField>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField htmlFor="receipt-date" label={t('receiptDate')} error={errors.receiptDate?.message}>
          <Controller
            control={control}
            name="receiptDate"
            rules={{ required: t('dateRequired') }}
            render={({ field }) => <DatePicker id="receipt-date" value={field.value} onChange={field.onChange} />}
          />
        </FormField>

        <FormField htmlFor="receipt-amount" label={t('amount')} error={errors.amount?.message}>
          <Controller
            name="amount"
            control={control}
            rules={{
              validate: (v) => {
                if (v.trim() === '') return t('amountRequired');
                if (!Number.isFinite(Number(v))) return t('amountInvalid');
                // The API accepts a zero or negative receipt: `@IsDecimal()` permits both.
                // A payment of nothing is not a payment.
                return Number(v) > 0 || t('amountNotPositive');
              },
            }}
            render={({ field }) => (
              <MoneyInput
                id="receipt-amount"
                aria-invalid={Boolean(errors.amount)}
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                name={field.name}
              />
            )}
          />
        </FormField>
      </div>

      {mayPost && clientId ? (
        <section aria-labelledby="receipt-apply" className="space-y-3 rounded-panel border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="receipt-apply" className="text-body font-semibold text-foreground">
              {t('applyTitle')}
            </h3>
            {manual ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setManual(null)}>
                {t('applyOldestFirst')}
              </Button>
            ) : null}
          </div>
          {invoices.isError ? (
            <LoadError message={t('invoicesLoadFailed')} onRetry={() => void invoices.refetch()} />
          ) : open.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">{t('noOpenInvoices')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {open.map((o) => {
                const id = `apply-${o.invoice.id}`;
                const ref = o.invoice.invoiceNumber ?? t('unnumbered');
                return (
                  <li key={o.invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <label htmlFor={id} className="min-w-0 text-body-sm">
                      <span className="font-medium text-foreground">{ref}</span>
                      <span className="block text-caption text-muted-foreground">
                        {t('invoiceLine', { due: formatDate(o.invoice.dueDate) ?? '', owed: money(o.outstandingMinor) })}
                      </span>
                    </label>
                    <MoneyInput
                      id={id}
                      className="w-36"
                      aria-label={t('applyTo', { ref })}
                      aria-invalid={appliedFor(o.invoice.id) > o.outstandingMinor}
                      value={manual ? (manual[o.invoice.id] ?? '') : fromMinorUnits(suggested.get(o.invoice.id) ?? 0)}
                      onValueChange={(value) =>
                        setManual((current) => ({
                          ...Object.fromEntries(open.map((x) => [x.invoice.id, fromMinorUnits(suggested.get(x.invoice.id) ?? 0)])),
                          ...current,
                          [o.invoice.id]: value,
                        }))
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
          <p className={overApplied || overInvoice ? 'text-body-sm font-medium text-danger' : 'text-body-sm text-muted-foreground'} role={overApplied || overInvoice ? 'alert' : undefined}>
            {overInvoice
              ? t('overInvoice', { ref: overInvoice.invoice.invoiceNumber ?? t('unnumbered') })
              : overApplied
                ? t('overApplied', { applied: money(appliedMinor), amount: money(amountMinor) })
                : t('applySummary', { applied: money(appliedMinor), left: money(Math.max(leftMinor, 0)) })}
          </p>
        </section>
      ) : null}

      <FormField htmlFor="receipt-reference" label={t('reference')}>
        <Input id="receipt-reference" aria-describedby="receipt-reference-hint" {...register('reference')} />
        <p id="receipt-reference-hint" className="text-xs text-muted-foreground">
          {t('referenceHint')}
        </p>
      </FormField>

      <FormField htmlFor="receipt-notes" label={t('notes')}>
        <Input id="receipt-notes" {...register('notes')} />
      </FormField>

      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
        <Button type="submit" loading={pending} loadingText={tCommon('loading')}>
          {mayPost ? t('submitReceive') : t('submit')}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/receipts">{t('cancel')}</Link>
        </Button>
      </div>
    </form>
  );
}
