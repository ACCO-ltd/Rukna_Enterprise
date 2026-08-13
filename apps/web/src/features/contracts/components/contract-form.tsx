'use client';

import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BoqVersionStatus } from '@erp/types';
import { Alert, Button, FormField, FormSection, Input, Select } from '@erp/ui';

import { useBoq } from '@/features/boq/hooks/use-boq';
import { useClients } from '@/features/clients/hooks/use-clients';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { ApiError } from '@/lib/api-client';

import {
  EMPTY_CONTRACT_FORM,
  toContractFormValues,
  toCreateContractPayload,
  toUpdateContractPayload,
  type ContractFormValues,
} from '../contract-form-payload';
import { useCreateContract, useUpdateContract } from '../hooks/use-contracts';
import { BILLING_MODELS, type Contract } from '../types';

const CURRENCIES = ['USD', 'SOS', 'AED'] as const;

interface ContractFormProps {
  /** Present in edit mode. The API accepts edits only while the contract is DRAFT. */
  contract?: Contract;
}

export function ContractForm({ contract }: ContractFormProps = {}) {
  const t = useTranslations('platform.contracts.create');
  const tContracts = useTranslations('platform.contracts');
  const tCommon = useTranslations('common');
  const tCurrency = useTranslations('common.currency');
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
  });

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
    setValue,
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
    defaultValues: contract
      ? toContractFormValues(contract)
      : { ...EMPTY_CONTRACT_FORM, projectId: requestedProjectId },
  });

  // The BOQ version list depends on the chosen project, so the field is watched rather
  // than read once. `useWatch` rather than `watch()` — the latter opts the component out
  // of React Compiler memoization.
  const selectedProjectId = useWatch({ control, name: 'projectId' });
  const boq = useBoq(selectedProjectId);

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
    (v) => v.status === BoqVersionStatus.BASELINED,
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

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          htmlFor="contract-value"
          label={t('value')}
          error={errors.contractValue?.message}
        >
          <Input
            id="contract-value"
            inputMode="decimal"
            dir="ltr"
            aria-invalid={Boolean(errors.contractValue)}
            {...register('contractValue')}
          />
        </FormField>

        <FormField htmlFor="contract-currency" label={t('currency')} error={errors.currency?.message}>
          <Select
            id="contract-currency"
            aria-invalid={Boolean(errors.currency)}
            {...register('currency')}
          >
            <option value="">{t('currencyPlaceholder')}</option>
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {tCurrency(code.toLowerCase())}
              </option>
            ))}
          </Select>
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
