'use client';

import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { ArrowRight, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, Button, DatePicker, FormField, FormSection, Select } from '@erp/ui';

import { useBoqWorkspace } from '@/features/boq/hooks/use-boq';
import { useClients } from '@/features/clients/hooks/use-clients';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { EmptyState } from '@/components/empty-state';
import { FormActions } from '@/components/form-actions';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';

import { toMinimalCreateContractPayload } from '../contract-form-payload';
import { useCreateContract } from '../hooks/use-contracts';
import { BILLING_MODELS, BillingModel } from '../types';

/**
 * The user-editable slice of the create form. Project and client are context (the route and the
 * project record), not inputs, so they are threaded in at submit time rather than held as fields —
 * which keeps a client that loads after mount from ever being submitted blank.
 */
interface CreateContractFields {
  billingModel: string;
  startDate: string;
  expectedEndDate: string;
}

/**
 * The minimal contract-create form (ADR-030 S-CC-5).
 *
 * A new contract now collects only who it is with and when it runs: the client (inherited from the
 * project) plus start and expected-completion dates, and the billing model (MILESTONE by default).
 * The three fields the old form asked for are gone — the server resolves the project's committed
 * BOQ, ties the value out to it, and mints the contract number (C1 / CONST-COM-020..022). So the
 * value is shown read-only from the live tie-out and the number reads "assigned on create".
 *
 * The whole flow is gated on a committed BOQ: with nothing committed there is no value to tie out
 * to, so the form is replaced with a dead-end that sends the user to commit the BOQ first. The gate
 * is driven both by the workspace read model (no committed money band) and by the server's own
 * `BOQ_NOT_COMMITTED` refusal, so a race that commits/uncommits between load and submit still lands
 * on the same explanation rather than a raw error.
 */
export function ContractCreateForm({ projectId }: { projectId: string }) {
  const t = useTranslations('platform.contracts.create');
  const tContracts = useTranslations('platform.contracts');
  const tCommon = useTranslations('common');

  const create = useCreateContract();
  const projects = useProjects();
  const clients = useClients();
  const boq = useBoqWorkspace(projectId);

  const project = (projects.data ?? []).find((p) => p.id === projectId) ?? null;
  const clientId = project?.clientId ?? '';
  const clientName = clients.data?.find((c) => c.id === clientId)?.name ?? null;

  const moneyBand = boq.data?.moneyBand ?? null;
  // ADR-029 R-1 — a contract can only be tied out once the BOQ is committed. The money band's
  // life-stage is the plain-language committed signal; `inContractTotal` is the tie-out figure
  // (canViewCost-gated, so null when the caller's tier withholds it — still committed, just not
  // shown a number).
  const isCommitted = moneyBand?.lifeStage === 'COMMITTED';
  const tieOut = moneyBand?.inContractTotal ?? null;
  const tieOutCurrency = moneyBand?.currency ?? 'USD';

  const schema = z.object({
    billingModel: z.string(),
    startDate: z.string(),
    expectedEndDate: z.string(),
  });

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateContractFields>({
    resolver: zodResolver(
      schema.refine(
        (values) =>
          !values.startDate ||
          !values.expectedEndDate ||
          values.expectedEndDate >= values.startDate,
        { message: t('endBeforeStart'), path: ['expectedEndDate'] },
      ),
    ),
    // S-CC-4: MILESTONE (payment-schedule) is ACCO's default billing model.
    defaultValues: { billingModel: BillingModel.MILESTONE, startDate: '', expectedEndDate: '' },
  });

  const startDate = useWatch({ control, name: 'startDate' });

  // The server's own gate: if the BOQ was uncommitted between load and submit, the create is
  // refused with BOQ_NOT_COMMITTED — surfaced as the same dead-end rather than a raw error.
  const serverGated =
    create.error instanceof ApiError && create.error.code === 'BOQ_NOT_COMMITTED';

  const dataPending = projects.isPending || clients.isPending || boq.isPending;
  const dataFailed = projects.isError || clients.isError || boq.isError;

  if (dataPending) {
    return (
      <div
        className="h-72 animate-pulse rounded-panel border border-border bg-muted"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">{tCommon('loading')}</span>
      </div>
    );
  }

  if (dataFailed) {
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }

  // The no-committed-BOQ dead-end (S-CC-5). The contract value ties out to the committed scope, so
  // there is nothing to sign against until the BOQ is committed. Send the user there.
  if (!isCommitted || serverGated) {
    return (
      <EmptyState
        variant="page"
        icon={<Lock size={25} strokeWidth={1.8} aria-hidden="true" />}
        title={t('boqGateTitle')}
        description={t('boqGateHint')}
        action={
          <Button asChild>
            <Link href={`/projects/${projectId}/boq`}>
              {t('boqGateAction')}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </Button>
        }
      />
    );
  }

  const onSubmit = (values: CreateContractFields) => {
    if (create.isPending || !clientId) return;
    create.mutate(
      toMinimalCreateContractPayload({ ...values, projectId, clientId }),
    );
  };

  const errorMessages =
    create.error && !serverGated
      ? [
          create.error instanceof ApiError && create.error.messages.length > 0
            ? create.error.message
            : t('failed'),
        ]
      : [];

  const readonlyValue =
    tieOut !== null ? (formatMoney(tieOut, tieOutCurrency, 'en') ?? t('valueFromBoqUnknown')) : t('valueFromBoqUnknown');

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      className="space-y-7 rounded-panel border border-border bg-surface p-5 sm:p-8"
      noValidate
    >
      {errorMessages.length > 0 ? <Alert variant="error" messages={errorMessages} /> : null}

      {/* The contract's subject — project and client — is inherited, not chosen. The project is the
          route; its client follows from the project record. */}
      <FormSection variant="plain" title={t('project')}>
        <div className="border-b border-border pb-4">
          <p className="text-body-sm font-medium">{project?.name ?? projectId}</p>
          <p className="mt-1 text-body-sm text-muted-foreground">
            {clientName ?? (clientId ? tCommon('loading') : t('clientRequired'))}
          </p>
        </div>
      </FormSection>

      {/* Value and number are server-derived, shown read-only. The value is the committed-BOQ
          tie-out; the number is minted from the project code on create. */}
      <FormSection variant="plain" title={t('billingModel')}>
        <div className="grid gap-5 lg:grid-cols-2">
          <FormField htmlFor="contract-value" label={t('value')}>
            <div
              id="contract-value"
              className="flex min-h-11 items-center rounded-control border border-border bg-muted/40 px-3 text-body font-semibold tabular-nums text-foreground"
            >
              {readonlyValue}
            </div>
            <p className="text-xs text-muted-foreground">{t('valueFromBoq')}</p>
          </FormField>

          <FormField htmlFor="contract-number" label={t('number')}>
            <div
              id="contract-number"
              className="flex min-h-11 items-center rounded-control border border-dashed border-border bg-muted/40 px-3 text-body-sm text-muted-foreground"
            >
              {t('numberAuto')}
            </div>
            <p className="text-xs text-muted-foreground">{t('numberAutoHint')}</p>
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
        isPending={create.isPending}
        disabled={!clientId}
        submitLabel={t('submit')}
        cancelLabel={t('cancel')}
        cancelHref={`/projects/${projectId}/commercial/contract-security`}
      />
    </form>
  );
}
