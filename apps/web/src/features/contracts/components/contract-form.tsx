'use client';

import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import {
  Alert,
  DatePicker,
  FormField,
  FormSection,
  Input,
  MoneyInput,
  Select,
} from '@erp/ui';

import { FormActions } from '@/components/form-actions';
import { ApiError } from '@/lib/api-client';

import {
  toContractFormValues,
  toUpdateContractPayload,
  type ContractFormValues,
} from '../contract-form-payload';
import { useUpdateContract } from '../hooks/use-contracts';
import { BILLING_MODELS, type Contract } from '../types';

interface ContractFormProps {
  /** The DRAFT contract being edited. Create now lives in its own `ContractCreateForm` (S-CC-5). */
  contract: Contract;
  /** Project workspace context, for the cancel back-link. */
  projectId?: string;
}

/**
 * Edit a DRAFT contract's commercial terms.
 *
 * Create no longer runs through here — the minimal create flow (ADR-030 S-CC-5) is a near-empty
 * form of its own (`ContractCreateForm`) because a new contract collects only client + dates and
 * derives its value, number and BOQ version server-side. Edit still corrects the terms the API's
 * `UpdateContractDto` accepts (number, value, billing model, dates); the project, client and BOQ
 * version a contract is *for* are fixed at creation and shown read-only, not as inputs.
 */
export function ContractForm({ contract, projectId }: ContractFormProps) {
  const t = useTranslations('platform.contracts.create');
  const tContracts = useTranslations('platform.contracts');

  const update = useUpdateContract(contract.id);
  const { isPending, error } = update;

  const schema = z.object({
    projectId: z.string(),
    clientId: z.string(),
    boqVersionId: z.string(),
    contractNumber: z.string().trim().min(1, t('numberRequired')).max(50, t('numberTooLong')),
    contractValue: z
      .string()
      .trim()
      .min(1, t('valueRequired'))
      .refine((v) => Number.isFinite(Number(v)), t('valueInvalid'))
      .refine((v) => Number(v) >= 0, t('valueNegative'))
      .refine((v) => /^\d*(\.\d{1,2})?$/.test(v), t('valueDecimals')),
    currency: z.string().min(1, t('currencyRequired')),
    billingModel: z.string(),
    startDate: z.string(),
    expectedEndDate: z.string(),
    // The payment plan is create-only (there is no PATCH for it); edit never populates or submits
    // it, but the field is typed so the form values keep matching `ContractFormValues`.
    paymentPlan: z.array(
      z.object({
        name: z.string(),
        percentage: z.string(),
        triggerType: z.string(),
        milestoneLabel: z.string(),
        dueOffsetDays: z.string(),
      }),
    ),
  });

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ContractFormValues>({
    resolver: zodResolver(
      schema.refine(
        (values) =>
          !values.startDate ||
          !values.expectedEndDate ||
          values.expectedEndDate >= values.startDate,
        { message: t('endBeforeStart'), path: ['expectedEndDate'] },
      ),
    ),
    defaultValues: toContractFormValues(contract),
  });

  const startDate = useWatch({ control, name: 'startDate' });

  const onSubmit = (values: ContractFormValues) => {
    if (isPending) return;
    update.mutate(toUpdateContractPayload(values));
  };

  const isDuplicateNumber = error instanceof ApiError && error.status === 409;
  const errorMessages = isDuplicateNumber
    ? [t('duplicateNumber')]
    : error
      ? [error instanceof ApiError && error.messages.length > 0 ? error.message : t('failed')]
      : [];

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      className="space-y-7 rounded-panel border border-border bg-surface p-5 sm:p-8"
      noValidate
    >
      {errorMessages.length > 0 ? <Alert variant="error" messages={errorMessages} /> : null}

      {/* What a contract is FOR cannot change after creation — UpdateContractDto declares none of
          project, client or BOQ version. They are stated read-only so the user still sees what the
          contract is against. */}
      <FormSection variant="plain" title={t('project')}>
        <Alert variant="info" messages={[t('identityFixed')]} />
      </FormSection>

      <FormSection variant="plain" title={t('billingModel')}>
        <div className="grid gap-5 lg:grid-cols-2">
          <FormField
            htmlFor="contract-number"
            label={t('number')}
            error={
              errors.contractNumber?.message ??
              (isDuplicateNumber ? t('duplicateNumber') : undefined)
            }
          >
            <Input
              id="contract-number"
              aria-invalid={Boolean(errors.contractNumber)}
              {...register('contractNumber')}
            />
          </FormField>

          <FormField
            htmlFor="contract-value"
            label={t('value')}
            error={errors.contractValue?.message}
          >
            <Controller
              name="contractValue"
              control={control}
              render={({ field }) => (
                <MoneyInput
                  id="contract-value"
                  dir="ltr"
                  aria-invalid={Boolean(errors.contractValue)}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  name={field.name}
                />
              )}
            />
          </FormField>

          <FormField htmlFor="contract-billing" label={t('billingModel')}>
            <Controller
              control={control}
              name="billingModel"
              render={({ field }) => (
                <Select id="contract-billing" value={field.value} onChange={field.onChange}>
                  {BILLING_MODELS.map((model) => (
                    <option key={model} value={model}>
                      {tContracts(`billingModel.${model}`)}
                    </option>
                  ))}
                </Select>
              )}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection variant="plain" title={t('startDate')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField htmlFor="contract-start" label={t('startDate')}>
            <Controller
              control={control}
              name="startDate"
              render={({ field }) => (
                <DatePicker id="contract-start" value={field.value} onChange={field.onChange} />
              )}
            />
          </FormField>

          <FormField
            htmlFor="contract-end"
            label={t('expectedEnd')}
            error={errors.expectedEndDate?.message}
          >
            <Controller
              control={control}
              name="expectedEndDate"
              render={({ field }) => (
                // The end of a contract cannot precede its start; constraining the calendar stops
                // the wrong value before validation has to explain it.
                <DatePicker
                  id="contract-end"
                  value={field.value}
                  onChange={field.onChange}
                  min={startDate || undefined}
                />
              )}
            />
          </FormField>
        </div>
      </FormSection>

      <FormActions
        isPending={isPending}
        submitLabel={t('saveChanges')}
        cancelLabel={t('cancel')}
        cancelHref={
          projectId
            ? `/projects/${projectId}/commercial/contract-security`
            : `/contracts/${contract.id}`
        }
      />
    </form>
  );
}
