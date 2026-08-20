'use client';

import { useForm } from 'react-hook-form';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, FormSection, Input } from '@erp/ui';

import { ApiError } from '@/lib/api-client';

import { useCreateIpa } from '../hooks/use-ipa';

interface IpaFormValues {
  periodFrom: string;
  periodTo: string;
  notes: string;
}

/**
 * Creates a payment application against a contract.
 *
 * Deliberately minimal: an application starts empty and is built up from claimed lines.
 * The platform is single-currency (USD, ADR-024), so there are no exchange-rate fields.
 */
export function IpaForm({ contractId }: { contractId: string }) {
  const t = useTranslations('platform.ipa.create');
  const tCommon = useTranslations('common');
  const create = useCreateIpa(contractId);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<IpaFormValues>({
    defaultValues: { periodFrom: '', periodTo: '', notes: '' },
  });

  const onSubmit = (values: IpaFormValues) => {
    create.mutate({
      contractId,
      ...(values.periodFrom ? { periodFrom: values.periodFrom } : {}),
      ...(values.periodTo ? { periodTo: values.periodTo } : {}),
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

      <FormSection title={t('periodFrom')}>
        <div className="grid gap-5 sm:grid-cols-2">
        <FormField htmlFor="ipa-from" label={t('periodFrom')}>
          <Input
            id="ipa-from"
            type="date"
            aria-describedby="ipa-period-hint"
            {...register('periodFrom')}
          />
        </FormField>

        <FormField htmlFor="ipa-to" label={t('periodTo')} error={errors.periodTo?.message}>
          <Input
            id="ipa-to"
            type="date"
            aria-invalid={Boolean(errors.periodTo)}
            {...register('periodTo', {
              validate: (v) => {
                // A period that ends before it starts is a data-entry error the API does
                // not catch — both fields are only @IsDateString().
                const from = getValues('periodFrom');
                return !v || !from || v >= from || t('endBeforeStart');
              },
            })}
          />
        </FormField>
        </div>

        <p id="ipa-period-hint" className="text-xs text-muted-foreground">
          {t('periodHint')}
        </p>
      </FormSection>

      <FormSection title={t('notes')}>
        <FormField htmlFor="ipa-notes" label={t('notes')}>
          <Input id="ipa-notes" {...register('notes')} />
        </FormField>
      </FormSection>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm sm:flex-row-reverse sm:justify-start">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? tCommon('loading') : t('submit')}
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/contracts/${contractId}`}>{t('cancel')}</Link>
        </Button>
      </div>
    </form>
  );
}
