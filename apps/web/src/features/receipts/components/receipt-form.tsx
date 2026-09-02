'use client';

import { Controller, useForm } from 'react-hook-form';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, DatePicker, FormField, Input, MoneyInput, Select } from '@erp/ui';

import { useClients } from '@/features/clients/hooks/use-clients';
import { toDecimalString } from '@/features/contracts/contract-form-payload';
import { ApiError } from '@/lib/api-client';

import { useCreateReceipt } from '../hooks/use-receipts';

interface ReceiptFormValues {
  clientId: string;
  receiptDate: string;
  amount: string;
  reference: string;
  notes: string;
}

export function ReceiptForm() {
  const t = useTranslations('platform.receipts.create');
  const tCommon = useTranslations('common');

  const create = useCreateReceipt();
  const clients = useClients();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ReceiptFormValues>({
    defaultValues: {
      clientId: '',
      receiptDate: '',
      amount: '',
      reference: '',
      notes: '',
    },
  });

  const onSubmit = (values: ReceiptFormValues) => {
    create.mutate({
      clientId: values.clientId,
      receiptDate: values.receiptDate,
      amount: toDecimalString(values.amount),
      // Single-currency platform (ADR-024): USD is implicit, never entered.
      currency: 'USD',
      ...(values.reference.trim() ? { reference: values.reference.trim() } : {}),
      ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
    });
  };

  const errorMessages = create.error
    ? [
        create.error instanceof ApiError && create.error.messages.length > 0
          ? create.error.message
          : t('failed'),
      ]
    : [];

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      className="space-y-5"
      noValidate
    >
      {errorMessages.length > 0 ? <Alert variant="error" messages={errorMessages} /> : null}
      {clients.isError ? <Alert variant="error" messages={[t('loadFailed')]} /> : null}

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
              onChange={field.onChange}
            >
              <option value="">
                {clients.isPending ? tCommon('loading') : t('clientPlaceholder')}
              </option>
              {(clients.data ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.code} — {client.name}
                </option>
              ))}
            </Select>
          )}
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          htmlFor="receipt-date"
          label={t('receiptDate')}
          error={errors.receiptDate?.message}
        >
          <Controller
            control={control}
            name="receiptDate"
            rules={{ required: t('dateRequired') }}
            render={({ field }) => (
              <DatePicker id="receipt-date" value={field.value} onChange={field.onChange} />
            )}
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

      <FormField htmlFor="receipt-reference" label={t('reference')}>
        <Input
          id="receipt-reference"
          aria-describedby="receipt-reference-hint"
          {...register('reference')}
        />
        <p id="receipt-reference-hint" className="text-xs text-muted-foreground">
          {t('referenceHint')}
        </p>
      </FormField>

      <FormField htmlFor="receipt-notes" label={t('notes')}>
        <Input id="receipt-notes" {...register('notes')} />
      </FormField>

      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? tCommon('loading') : t('submit')}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/receipts">{t('cancel')}</Link>
        </Button>
      </div>
    </form>
  );
}
