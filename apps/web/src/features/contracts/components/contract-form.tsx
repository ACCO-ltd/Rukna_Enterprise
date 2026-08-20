'use client';

import { useEffect } from 'react';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BoqVersionStatus, PaymentTrigger } from '@erp/types';
import { Alert, Button, FormField, FormSection, Input, MoneyInput, Select } from '@erp/ui';

import { useBoqWorkspace } from '@/features/boq/hooks/use-boq';
import { useClients } from '@/features/clients/hooks/use-clients';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { ApiError } from '@/lib/api-client';

import {
  EMPTY_CONTRACT_FORM,
  EMPTY_PAYMENT_PLAN_ROW,
  paymentPlanTotalPercent,
  toContractFormValues,
  toCreateContractPayload,
  toUpdateContractPayload,
  type ContractFormValues,
} from '../contract-form-payload';
import { useCreateContract, useUpdateContract } from '../hooks/use-contracts';
import { BILLING_MODELS, BillingModel, type Contract } from '../types';

const PAYMENT_TRIGGERS = [
  PaymentTrigger.MILESTONE,
  PaymentTrigger.ADVANCE,
  PaymentTrigger.TIME_BASED,
] as const;

interface ContractFormProps {
  /** Present in edit mode. The API accepts edits only while the contract is DRAFT. */
  contract?: Contract;
}

export function ContractForm({ contract }: ContractFormProps = {}) {
  const t = useTranslations('platform.contracts.create');
  const tContracts = useTranslations('platform.contracts');
  const tCommon = useTranslations('common');
  const isEdit = contract !== undefined;
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get('projectId') ?? '';

  const create = useCreateContract();
  const update = useUpdateContract(contract?.id ?? '');
  const { isPending, error } = isEdit ? update : create;

  const projects = useProjects();
  const clients = useClients();

  const schema = z.object({
    projectId: z.string().min(1, t('projectRequired')),
    clientId: z.string().min(1, t('clientRequired')),
    boqVersionId: z.string().min(1, t('boqVersionRequired')),
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

  // ADR-023 CONST-COM-012, mirrored client-side: a MILESTONE contract's plan (when the user
  // added rows) must have positive, ≤2-dp percents summing to 100%, and a TIME_BASED row needs
  // a day offset. The plan is optional — an empty plan is a valid MILESTONE contract.
  const validatePlan = (values: ContractFormValues, ctx: z.RefinementCtx) => {
    if (values.billingModel !== BillingModel.MILESTONE || values.paymentPlan.length === 0) return;

    values.paymentPlan.forEach((row, i) => {
      if (!row.name.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentPlan', i, 'name'], message: t('plan.nameRequired') });
      }
      const pct = row.percentage.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(pct) || Number(pct) <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentPlan', i, 'percentage'], message: t('plan.percentInvalid') });
      }
      if (row.triggerType === PaymentTrigger.TIME_BASED && !row.dueOffsetDays.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentPlan', i, 'dueOffsetDays'], message: t('plan.offsetRequired') });
      }
    });

    const total = paymentPlanTotalPercent(values.paymentPlan);
    if (Math.abs(total - 100) > 0.001) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentPlan'], message: t('plan.totalMismatch', { total }) });
    }
  };

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
    setValue,
  } = useForm<ContractFormValues>({
    resolver: zodResolver(
      schema
        .refine(
          (values) =>
            !values.startDate ||
            !values.expectedEndDate ||
            values.expectedEndDate >= values.startDate,
          { message: t('endBeforeStart'), path: ['expectedEndDate'] },
        )
        .superRefine(validatePlan),
    ),
    defaultValues: contract
      ? toContractFormValues(contract)
      : { ...EMPTY_CONTRACT_FORM, projectId: requestedProjectId },
  });

  const { fields: planFields, append: appendPlan, remove: removePlan } = useFieldArray({
    control,
    name: 'paymentPlan',
  });

  // The BOQ version list depends on the chosen project, so the field is watched rather
  // than read once. `useWatch` rather than `watch()` — the latter opts the component out
  // of React Compiler memoization.
  const selectedProjectId = useWatch({ control, name: 'projectId' });
  const boq = useBoqWorkspace(selectedProjectId);

  // The payment-plan builder is a MILESTONE-only, create-only affordance (there is no PATCH
  // for the plan). The running total drives a live indicator and the reconciliation guard.
  const billingModel = useWatch({ control, name: 'billingModel' });
  const planRows = useWatch({ control, name: 'paymentPlan' }) ?? [];
  const showPaymentPlan = !isEdit && billingModel === BillingModel.MILESTONE;
  const planTotal = paymentPlanTotalPercent(planRows);
  const planBalanced = planRows.length > 0 && Math.abs(planTotal - 100) <= 0.001;

  // The project command centre can open this form with its project in context. The related
  // client is derived from that real project record rather than copied into the URL.
  useEffect(() => {
    if (isEdit || !requestedProjectId) return;
    const project = (projects.data ?? []).find((item) => item.id === requestedProjectId);
    if (project?.clientId) setValue('clientId', project.clientId, { shouldValidate: true });
  }, [isEdit, projects.data, requestedProjectId, setValue]);

  /**
   * Only BASELINED versions may back a contract — `ContractService.create` rejects
   * anything else with a 400 (`contract.service.ts:60`). Filtering here means the picker
   * cannot offer a choice the server will refuse.
   */
  const baselinedVersions = (boq.data?.versions ?? []).filter(
    (version) => version.status === BoqVersionStatus.BASELINED,
  );

  const onSubmit = (values: ContractFormValues) => {
    if (isEdit) update.mutate(toUpdateContractPayload(values));
    else create.mutate(toCreateContractPayload(values));
  };

  const isDuplicateNumber = error instanceof ApiError && error.status === 409;
  const errorMessages = isDuplicateNumber
    ? [t('duplicateNumber')]
    : error
      ? [error instanceof ApiError && error.messages.length > 0 ? error.message : t('failed')]
      : [];

  const dataFailed = projects.isError || clients.isError;

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      className="space-y-5"
      noValidate
    >
      {errorMessages.length > 0 ? <Alert variant="error" messages={errorMessages} /> : null}
      {dataFailed ? <Alert variant="error" messages={[t('loadFailed')]} /> : null}

      {/* What a contract is FOR cannot change after creation — UpdateContractDto declares
          none of these three. In edit mode they are shown read-only rather than hidden, so
          the user can still see what the contract is against. */}
      <FormSection title={t('project')}>
        {isEdit ? (
          <Alert variant="info" messages={[t('identityFixed')]} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
          <FormField htmlFor="contract-project" label={t('project')} error={errors.projectId?.message}>
            <Select
              id="contract-project"
              aria-describedby="contract-project-hint"
              aria-invalid={Boolean(errors.projectId)}
              {...register('projectId')}
            >
              <option value="">{tCommon('required')}</option>
              {(projects.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} — {project.name}
                </option>
              ))}
            </Select>
            <p id="contract-project-hint" className="text-xs text-muted-foreground">
              {t('projectHint')}
            </p>
          </FormField>

          <FormField htmlFor="contract-client" label={t('client')} error={errors.clientId?.message}>
            <Select
              id="contract-client"
              aria-invalid={Boolean(errors.clientId)}
              {...register('clientId')}
            >
              <option value="">{tCommon('required')}</option>
              {(clients.data ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.code} — {client.name}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            htmlFor="contract-boq-version"
            label={t('boqVersion')}
            error={errors.boqVersionId?.message}
          >
            <Select
              id="contract-boq-version"
              aria-describedby="contract-boq-hint"
              aria-invalid={Boolean(errors.boqVersionId)}
              disabled={!selectedProjectId || boq.isPending}
              {...register('boqVersionId')}
            >
              <option value="">{tCommon('required')}</option>
              {baselinedVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.versionNumber}
                </option>
              ))}
            </Select>
            <p id="contract-boq-hint" className="text-xs text-muted-foreground">
              {!selectedProjectId
                ? t('boqVersionNoProject')
                : boq.isPending
                  ? tCommon('loading')
                  : baselinedVersions.length === 0
                    ? t('boqVersionNone')
                    : t('boqVersionHint')}
            </p>
          </FormField>
          </div>
        )}
      </FormSection>

      <FormSection title={t('billingModel')}>
        <div className="grid gap-5 lg:grid-cols-2">
          <FormField
            htmlFor="contract-number"
            label={t('number')}
            error={errors.contractNumber?.message ?? (isDuplicateNumber ? t('duplicateNumber') : undefined)}
          >
            <Input
              id="contract-number"
              aria-invalid={Boolean(errors.contractNumber)}
              {...register('contractNumber')}
            />
          </FormField>

      <div className="grid gap-5">
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
      </div>

      <FormField htmlFor="contract-billing" label={t('billingModel')}>
        <Select id="contract-billing" {...register('billingModel')}>
          {BILLING_MODELS.map((model) => (
            <option key={model} value={model}>
              {tContracts(`billingModel.${model}`)}
            </option>
          ))}
        </Select>
      </FormField>
        </div>
      </FormSection>

      {showPaymentPlan ? (
        <FormSection title={t('plan.title')}>
          <p className="text-xs text-muted-foreground">{t('plan.subtitle')}</p>

          {planFields.length === 0 ? (
            <p className="mt-3 rounded-panel border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
              {t('plan.empty')}
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {planFields.map((field, index) => (
                <PlanRowFields
                  key={field.id}
                  index={index}
                  control={control}
                  register={register}
                  errors={errors}
                  onRemove={() => removePlan(index)}
                  t={t}
                />
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => appendPlan({ ...EMPTY_PAYMENT_PLAN_ROW })}
            >
              <Plus size={16} aria-hidden="true" /> {t('plan.add')}
            </Button>
            {planFields.length > 0 ? (
              <p
                className={`text-sm font-medium ${planBalanced ? 'text-success' : 'text-danger'}`}
                aria-live="polite"
              >
                {planBalanced ? t('plan.totalOk') : t('plan.total', { total: planTotal })}
              </p>
            ) : null}
          </div>
        </FormSection>
      ) : null}

      <FormSection title={t('startDate')}>
        <div className="grid gap-5 sm:grid-cols-2">
        <FormField htmlFor="contract-start" label={t('startDate')}>
          <Input id="contract-start" type="date" {...register('startDate')} />
        </FormField>

        <FormField
          htmlFor="contract-end"
          label={t('expectedEnd')}
          error={errors.expectedEndDate?.message}
        >
          <Input
            id="contract-end"
            type="date"
            aria-invalid={Boolean(errors.expectedEndDate)}
            {...register('expectedEndDate')}
          />
        </FormField>
        </div>
      </FormSection>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm sm:flex-row-reverse sm:justify-start">
        <Button type="submit" disabled={isPending}>
          {isPending ? tCommon('loading') : isEdit ? t('saveChanges') : t('submit')}
        </Button>
        <Button variant="outline" asChild>
          <Link href={isEdit ? `/contracts/${contract.id}` : '/contracts'}>{t('cancel')}</Link>
        </Button>
      </div>
    </form>
  );
}

/**
 * One payment-plan installment row. Extracted so each row can watch its own trigger without
 * re-rendering the whole form: a TIME_BASED installment shows a day-offset field, everything
 * else shows the free-text milestone label.
 */
function PlanRowFields({
  index,
  control,
  register,
  errors,
  onRemove,
  t,
}: {
  index: number;
  control: Control<ContractFormValues>;
  register: UseFormRegister<ContractFormValues>;
  errors: FieldErrors<ContractFormValues>;
  onRemove: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const trigger = useWatch({ control, name: `paymentPlan.${index}.triggerType` });
  const rowErrors = errors.paymentPlan?.[index];

  return (
    <li className="rounded-panel border border-border bg-surface p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField htmlFor={`plan-${index}-name`} label={t('plan.name')} error={rowErrors?.name?.message}>
          <Input
            id={`plan-${index}-name`}
            placeholder={t('plan.namePlaceholder')}
            aria-invalid={Boolean(rowErrors?.name)}
            {...register(`paymentPlan.${index}.name`)}
          />
        </FormField>

        <FormField
          htmlFor={`plan-${index}-percent`}
          label={t('plan.percent')}
          error={rowErrors?.percentage?.message}
        >
          <Input
            id={`plan-${index}-percent`}
            inputMode="decimal"
            dir="ltr"
            aria-invalid={Boolean(rowErrors?.percentage)}
            {...register(`paymentPlan.${index}.percentage`)}
          />
        </FormField>

        <FormField htmlFor={`plan-${index}-trigger`} label={t('plan.trigger')}>
          <Select id={`plan-${index}-trigger`} {...register(`paymentPlan.${index}.triggerType`)}>
            {PAYMENT_TRIGGERS.map((tr) => (
              <option key={tr} value={tr}>
                {t(`plan.triggerType.${tr}`)}
              </option>
            ))}
          </Select>
        </FormField>

        {trigger === PaymentTrigger.TIME_BASED ? (
          <FormField
            htmlFor={`plan-${index}-offset`}
            label={t('plan.offsetDays')}
            error={rowErrors?.dueOffsetDays?.message}
          >
            <Input
              id={`plan-${index}-offset`}
              type="number"
              min="0"
              inputMode="numeric"
              dir="ltr"
              aria-invalid={Boolean(rowErrors?.dueOffsetDays)}
              {...register(`paymentPlan.${index}.dueOffsetDays`)}
            />
          </FormField>
        ) : (
          <FormField htmlFor={`plan-${index}-label`} label={t('plan.milestoneLabel')}>
            <Input
              id={`plan-${index}-label`}
              placeholder={t('plan.milestoneLabelPlaceholder')}
              {...register(`paymentPlan.${index}.milestoneLabel`)}
            />
          </FormField>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 size={15} aria-hidden="true" /> {t('plan.remove')}
        </Button>
      </div>
    </li>
  );
}
