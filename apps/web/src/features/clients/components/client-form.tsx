'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input, Select } from '@erp/ui';

import { ApiError } from '@/lib/api-client';

import {
  EMPTY_CLIENT_FORM,
  toClientFormValues,
  toCreateClientPayload,
  toUpdateClientPayload,
  type ClientFormValues,
} from '../client-form-payload';
import { useCreateClient, useUpdateClient } from '../hooks/use-client';
import type { Client } from '../types';

/** Currencies offered in the picker, matching the `common.currency` message keys. */
const CURRENCIES = ['USD', 'SOS', 'AED'] as const;

interface ClientFormProps {
  /** Present in edit mode. */
  client?: Client;
}

export function ClientForm({ client }: ClientFormProps = {}) {
  const t = useTranslations('platform.clients.create');
  const tCommon = useTranslations('common');
  const tCurrency = useTranslations('common.currency');
  const isEdit = client !== undefined;

  const create = useCreateClient();
  const update = useUpdateClient(client?.id ?? '');
  const { isPending, error } = isEdit ? update : create;

  /**
   * Mirrors CreateClientDto's constraints — code `@Length(1, 30)`, taxNumber
   * `@MaxLength(50)`. The server stays the authority; this only spares a round-trip to be
   * told something we already knew.
   */
  const schema = z.object({
    code: z.string().trim().min(1, t('codeRequired')).max(30, t('codeTooLong')),
    name: z.string().trim().min(1, t('nameRequired')).max(255, t('nameTooLong')),
    nameAr: z.string().max(255, t('nameTooLong')),
    taxNumber: z.string().max(50, t('taxNumberTooLong')),
    defaultCurrency: z.string(),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(schema),
    defaultValues: client ? toClientFormValues(client) : EMPTY_CLIENT_FORM,
  });

  const onSubmit = (values: ClientFormValues) => {
    if (isEdit) update.mutate(toUpdateClientPayload(values));
    else create.mutate(toCreateClientPayload(values));
  };

  // 409 is the one error with a specific, actionable cause: the code is taken.
  const isDuplicateCode = error instanceof ApiError && error.status === 409;
  const errorMessages = isDuplicateCode
    ? [t('duplicateCode')]
    : error
      ? [error instanceof ApiError && error.messages.length > 0 ? error.message : t('failed')]
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

      <FormField
        htmlFor="client-code"
        label={t('code')}
        error={errors.code?.message ?? (isDuplicateCode ? t('duplicateCode') : undefined)}
      >
        <Input
          id="client-code"
          aria-describedby="client-code-hint"
          aria-invalid={Boolean(errors.code)}
          // Immutable after creation — shown read-only rather than hidden, because the
          // code is how people identify the client. `readOnly` rather than `disabled`:
          // a disabled input is skipped in the tab order and its value is not submitted.
          readOnly={isEdit}
          className={isEdit ? 'bg-muted text-muted-foreground' : undefined}
          {...register('code')}
        />
        <p id="client-code-hint" className="text-xs text-muted-foreground">
          {t('codeHint')}
        </p>
      </FormField>

      <FormField htmlFor="client-name" label={t('name')} error={errors.name?.message}>
        <Input id="client-name" aria-invalid={Boolean(errors.name)} {...register('name')} />
      </FormField>

      <FormField htmlFor="client-name-ar" label={t('nameAr')} error={errors.nameAr?.message}>
        {/* dir/lang pinned so an Arabic name renders correctly while the UI is in English. */}
        <Input
          id="client-name-ar"
          dir="rtl"
          lang="ar"
          aria-invalid={Boolean(errors.nameAr)}
          {...register('nameAr')}
        />
      </FormField>

      <FormField htmlFor="client-tax" label={t('taxNumber')} error={errors.taxNumber?.message}>
        <Input id="client-tax" aria-invalid={Boolean(errors.taxNumber)} {...register('taxNumber')} />
      </FormField>

      <FormField htmlFor="client-currency" label={t('defaultCurrency')}>
        <Select id="client-currency" {...register('defaultCurrency')}>
          <option value="">{t('currencyPlaceholder')}</option>
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {tCurrency(code.toLowerCase())}
            </option>
          ))}
        </Select>
      </FormField>

      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
        <Button type="submit" disabled={isPending}>
          {isPending ? tCommon('loading') : isEdit ? t('saveChanges') : t('submit')}
        </Button>
        <Button variant="outline" asChild>
          <Link href={isEdit ? `/clients/${client.id}` : '/clients'}>{t('cancel')}</Link>
        </Button>
      </div>
    </form>
  );
}
