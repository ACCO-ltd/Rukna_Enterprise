'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input, Select, Textarea } from '@erp/ui';

import { ApiError } from '@/lib/api-client';

import { useCreateProject } from '../hooks/use-create-project';
import {
  EMPTY_PROJECT_FORM,
  toCreateProjectPayload,
  type ProjectFormValues,
} from '../project-form-payload';

/** Currencies offered in the picker, matching the `common.currency` message keys. */
const CURRENCIES = ['USD', 'SOS', 'AED'] as const;

export function ProjectForm() {
  const t = useTranslations('platform.projects.create');
  const tCurrency = useTranslations('common.currency');
  const { mutate, isPending, error } = useCreateProject();

  /**
   * Client validation deliberately mirrors CreateProjectDto's constraints (code 1–30,
   * name ≤255, contractValue ≥0 with ≤2 decimals). The server remains the authority —
   * this only spares the user a round-trip to be told something we already knew.
   */
  const schema = z.object({
    code: z.string().trim().min(1, t('codeRequired')).max(30, t('codeTooLong')),
    name: z.string().trim().min(1, t('nameRequired')).max(255, t('nameTooLong')),
    nameAr: z.string().max(255, t('nameTooLong')),
    description: z.string(),
    clientName: z.string().max(255, t('nameTooLong')),
    contractValue: z
      .string()
      .refine((v) => v.trim() === '' || Number.isFinite(Number(v)), t('contractValueInvalid'))
      .refine((v) => v.trim() === '' || Number(v) >= 0, t('contractValueNegative'))
      .refine(
        (v) => v.trim() === '' || /^\d*(\.\d{1,2})?$/.test(v.trim()),
        t('contractValueDecimals'),
      ),
    currency: z.string(),
    startDate: z.string(),
    expectedEndDate: z.string(),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(
      // Cross-field rule: a completion date before the start date is a data-entry error
      // the server does not catch, and it would quietly misreport the programme.
      schema.refine(
        (values) =>
          !values.startDate ||
          !values.expectedEndDate ||
          values.expectedEndDate >= values.startDate,
        { message: t('endBeforeStart'), path: ['expectedEndDate'] },
      ),
    ),
    defaultValues: EMPTY_PROJECT_FORM,
  });

  const onSubmit = (values: ProjectFormValues) => {
    mutate(toCreateProjectPayload(values));
  };

  // 409 is the one error with a specific, actionable cause: the code is taken.
  const isDuplicateCode = error instanceof ApiError && error.status === 409;
  const serverMessages =
    error instanceof ApiError && error.messages.length > 0 ? error.messages : undefined;

  return (
    <form className="space-y-6" onSubmit={handleSubmit(onSubmit)} noValidate>
      {error ? (
        <Alert
          variant="error"
          title={isDuplicateCode ? t('duplicateCode') : t('failed')}
          messages={isDuplicateCode ? undefined : serverMessages}
        />
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField htmlFor="code" label={t('codeLabel')} error={errors.code?.message}>
          <Input
            id="code"
            placeholder={t('codePlaceholder')}
            aria-describedby="code-hint"
            aria-invalid={Boolean(errors.code)}
            {...register('code')}
          />
          <p id="code-hint" className="text-xs text-muted-foreground">
            {t('codeHint')}
          </p>
        </FormField>

        <FormField htmlFor="clientName" label={t('clientNameLabel')} error={errors.clientName?.message}>
          <Input id="clientName" {...register('clientName')} />
        </FormField>

        <FormField htmlFor="name" label={t('nameLabel')} error={errors.name?.message}>
          <Input
            id="name"
            placeholder={t('namePlaceholder')}
            aria-invalid={Boolean(errors.name)}
            {...register('name')}
          />
        </FormField>

        <FormField htmlFor="nameAr" label={t('nameArLabel')} error={errors.nameAr?.message}>
          {/* dir="rtl" regardless of UI language: this field always holds Arabic. */}
          <Input id="nameAr" dir="rtl" {...register('nameAr')} />
        </FormField>
      </div>

      <FormField htmlFor="description" label={t('descriptionLabel')} error={errors.description?.message}>
        <Textarea id="description" {...register('description')} />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          htmlFor="contractValue"
          label={t('contractValueLabel')}
          error={errors.contractValue?.message}
        >
          <Input
            id="contractValue"
            // `inputMode="decimal"` gets the numeric keypad on mobile without the spinner
            // and scroll-to-change behaviour of type="number", which is hostile on a
            // financial field.
            inputMode="decimal"
            dir="ltr"
            className="text-start"
            aria-invalid={Boolean(errors.contractValue)}
            {...register('contractValue')}
          />
        </FormField>

        <FormField htmlFor="currency" label={t('currencyLabel')} error={errors.currency?.message}>
          <Select id="currency" {...register('currency')}>
            <option value="">{t('currencyNone')}</option>
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code} — {tCurrency(code.toLowerCase())}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField htmlFor="startDate" label={t('startDateLabel')} error={errors.startDate?.message}>
          <Input id="startDate" type="date" {...register('startDate')} />
        </FormField>

        <FormField
          htmlFor="expectedEndDate"
          label={t('expectedEndDateLabel')}
          error={errors.expectedEndDate?.message}
        >
          <Input
            id="expectedEndDate"
            type="date"
            aria-invalid={Boolean(errors.expectedEndDate)}
            {...register('expectedEndDate')}
          />
        </FormField>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row-reverse sm:justify-start">
        <Button type="submit" disabled={isPending}>
          {isPending ? t('submitting') : t('submit')}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/projects">{t('cancel')}</Link>
        </Button>
      </div>
    </form>
  );
}
