'use client';

import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { ArrowRight, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, FormSection, Select } from '@erp/ui';

import { useBoqWorkspace } from '@/features/boq/hooks/use-boq';
import { useClients } from '@/features/clients/hooks/use-clients';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { EmptyState } from '@/components/empty-state';
import { FormActions } from '@/components/form-actions';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import {
  paymentPlanTotalPercent,
  toMinimalCreateContractPayload,
  type PaymentPlanRow,
} from '../contract-form-payload';
import { ACCO_STANDARD_PLAN } from './payment-plan-fields';
import { PaymentPlanBuilder } from './payment-plan-builder';
import { useCreateContract } from '../hooks/use-contracts';
import { BILLING_MODELS, BillingModel } from '../types';

/**
 * The user-editable slice of the create form. Project and client are context (the route and the
 * project record), not inputs, so they are threaded in at submit time. Dates are no longer fields at
 * all (ADR-030): they are inherited from the project on submit. What the user sets is the billing
 * model and — for a MILESTONE contract — the payment schedule, right here.
 */
interface CreateContractFields {
  billingModel: string;
  paymentPlan: PaymentPlanRow[];
}

/**
 * The contract-create form (ADR-030 S-CC-5 + inline payment schedule).
 *
 * A new contract collects only who it is with (client, inherited from the project), its billing
 * model (MILESTONE by default), and — for a MILESTONE contract — its payment schedule, pre-seeded
 * with ACCO's 40/30/20/10 standard and edited inline so contract + schedule are created in one save.
 * The server resolves the project's committed BOQ, ties the value out to it (shown read-only), and
 * mints the contract number (C1 / CONST-COM-020..022).
 *
 * There are no date pickers: the contract's start and expected-completion dates are inherited from
 * the project. The contract still carries its own completion date (so Extension-of-Time has a
 * baseline to extend) — the form just does not ask the user to retype what the project already knows.
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

  const schema = z
    .object({
      billingModel: z.string(),
      paymentPlan: z.array(
        z.object({
          name: z.string(),
          percentage: z.string(),
          isAdvance: z.boolean(),
          dueDate: z.string(),
        }),
      ),
    })
    // The payment plan is only meaningful for a MILESTONE contract; validate it exactly as the
    // server's `assertPaymentPlanReconciles` does (every row named, a positive ≤2-dp percent, and
    // the whole plan totalling 100%) so a plan the server would 400 can never leave the form.
    .superRefine((values, ctx) => {
      if (values.billingModel !== BillingModel.MILESTONE) return;
      if (values.paymentPlan.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentPlan'], message: t('plan.empty') });
        return;
      }
      values.paymentPlan.forEach((row, i) => {
        if (!row.name.trim()) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentPlan', i, 'name'], message: t('plan.nameRequired') });
        }
        const pct = row.percentage.trim();
        if (!/^\d+(\.\d{1,2})?$/.test(pct) || Number(pct) <= 0) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentPlan', i, 'percentage'], message: t('plan.percentInvalid') });
        }
      });
      const total = paymentPlanTotalPercent(values.paymentPlan);
      if (Math.abs(total - 100) > 0.001) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentPlan'], message: t('plan.totalMismatch', { total }) });
      }
    });

  const {
    control,
    register,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateContractFields>({
    resolver: zodResolver(schema),
    // S-CC-4: MILESTONE (payment-schedule) is ACCO's default. Seed the plan with the house standard
    // so the schedule appears pre-filled and reconciled, ready to adjust rather than build blank.
    defaultValues: {
      billingModel: BillingModel.MILESTONE,
      paymentPlan: ACCO_STANDARD_PLAN.map((row) => ({ ...row })),
    },
  });

  const billingModel = useWatch({ control, name: 'billingModel' });
  const planRows = useWatch({ control, name: 'paymentPlan' }) ?? [];
  const isMilestone = billingModel === BillingModel.MILESTONE;
  // Mirror the builder's hard-stop: a milestone plan must reconcile to 100% before Save is allowed.
  const planBalanced =
    !isMilestone || (planRows.length > 0 && Math.abs(100 - paymentPlanTotalPercent(planRows)) <= 0.001);

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
      toMinimalCreateContractPayload({
        projectId,
        clientId,
        billingModel: values.billingModel,
        // Dates are inherited from the project — no date pickers on the form (ADR-030).
        startDate: project?.startDate ?? '',
        expectedEndDate: project?.expectedEndDate ?? '',
        paymentPlan:
          values.billingModel === BillingModel.MILESTONE ? values.paymentPlan : undefined,
      }),
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
    tieOut !== null
      ? (formatMoney(tieOut, tieOutCurrency, 'en') ?? t('valueFromBoqUnknown'))
      : t('valueFromBoqUnknown');

  // The array-level plan error (empty, or does-not-total-100) — row errors render on their fields.
  const planError = typeof errors.paymentPlan?.message === 'string' ? errors.paymentPlan.message : undefined;

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
          route; its client follows from the project record. The contract's dates are inherited from
          the project too (no pickers); they are shown read-only so the inheritance is visible, with a
          hint when the project has no completion date for Extension-of-Time to extend later. */}
      <FormSection variant="plain" title={t('project')}>
        <div className="border-b border-border pb-4">
          <p className="text-body-sm font-medium">{project?.name ?? projectId}</p>
          <p className="mt-1 text-body-sm text-muted-foreground">
            {clientName ?? (clientId ? tCommon('loading') : t('clientRequired'))}
          </p>
          <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1">
            <div>
              <dt className="text-caption text-muted-foreground">{t('startDate')}</dt>
              <dd className="text-body-sm tabular-nums text-foreground">
                {formatDate(project?.startDate ?? null, 'en') ?? t('dateNotSet')}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-muted-foreground">{t('expectedEnd')}</dt>
              <dd className="text-body-sm tabular-nums text-foreground">
                {formatDate(project?.expectedEndDate ?? null, 'en') ?? t('dateNotSet')}
              </dd>
            </div>
          </dl>
          {!project?.expectedEndDate ? (
            <p className="mt-2 text-caption text-warning">{t('completionMissingHint')}</p>
          ) : null}
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

      {/* The inline payment schedule (ADR-030) — only for a MILESTONE contract. Pre-seeded with the
          ACCO standard; the value each percent works out to is shown live against the tie-out. */}
      {isMilestone ? (
        <FormSection variant="plain" title={t('plan.title')}>
          <p className="text-xs text-muted-foreground">{t('plan.subtitle')}</p>
          {planError ? (
            <div className="mt-3">
              <Alert variant="error" messages={[planError]} />
            </div>
          ) : null}
          <div className="mt-3">
            <PaymentPlanBuilder
              control={control as never}
              register={register as never}
              setValue={setValue as never}
              errors={errors as never}
              t={t}
              contractValue={tieOut}
              currency={tieOutCurrency}
              locale="en"
              targetPercent={100}
              allowAdvance
              showAccoStandard
            />
          </div>
        </FormSection>
      ) : null}

      <FormActions
        isPending={create.isPending}
        disabled={!clientId || !planBalanced}
        submitLabel={t('submit')}
        cancelLabel={t('cancel')}
        cancelHref={`/projects/${projectId}/commercial/contract-security`}
      />
    </form>
  );
}
