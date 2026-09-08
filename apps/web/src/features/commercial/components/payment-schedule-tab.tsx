'use client';

import { useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarClock, Pencil, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { PaymentTrigger } from '@erp/types';
import type { CommercialSummaryResponse } from '@erp/types';
import { Alert, Button, FormSection, Skeleton, cn } from '@erp/ui';

import { EmptyState } from '@/components/empty-state';
import { usePermissions } from '@/features/auth/permissions/can';
import {
  buildPaymentPlan,
  EMPTY_PAYMENT_PLAN_ROW,
  paymentPlanTotalPercent,
  type ContractFormValues,
} from '@/features/contracts/contract-form-payload';
import {
  ACCO_STANDARD_PLAN,
  PlanRowFields,
} from '@/features/contracts/components/payment-plan-fields';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';

import { useCommercialCurrentCycle } from '../hooks/use-commercial';
import { useReplacePaymentPlan } from '../hooks/use-replace-payment-plan';
import { PaymentSchedulePanel } from './payment-schedule-panel';
import { SectionCard } from './commercial-ui';

/**
 * The first-class Payment Schedule tab for a MILESTONE (payment-schedule) contract
 * (commercial-billing-model-refinement §4.1/§5 P2).
 *
 * It consolidates the three scattered surfaces the schedule used to live across — the Overview
 * "Payment plan" panel, the Overview cycle card, and the Billing & Collection panel — into one home:
 *
 * - a summary strip stating the model and the plan's reconciliation to 100%,
 * - the reused `PaymentSchedulePanel` (the installment ledger, Generate-invoice, link-milestone and
 *   the CONST-COM-011 gate — unchanged from Billing & Collection),
 * - a DRAFT-only inline editor that re-profiles the whole schedule through the same replace-all
 *   route the create builder seeds, plus the "ACCO standard 40/30/20/10" template.
 *
 * The tab only mounts for a MILESTONE contract (the nav hides it otherwise), but it still degrades
 * to a no-contract empty state so a force-navigation lands on an explanation, not a crash.
 */
export function PaymentScheduleTab({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial');
  const contract = summary.mainContract;

  if (!contract) {
    return (
      <EmptyState
        variant="page"
        title={t('billing.noContractTitle')}
        description={t('billing.noContractHint')}
      />
    );
  }

  return (
    <div className="space-y-4">
      <SummaryStrip projectId={projectId} summary={summary} />

      {/* The ledger + generate-invoice + link-milestone + CONST-COM-011 gate, reused verbatim. */}
      <PaymentSchedulePanel projectId={projectId} contractId={contract.id} summary={summary} />

      <ScheduleEditor projectId={projectId} contractId={contract.id} status={contract.status} />
    </div>
  );
}

/**
 * The reconciliation strip: the billing model, and whether the plan totals exactly 100%.
 *
 * The percentages are read from the cycle read model (the same source the panel reads), and the
 * total is the plan's own reconciliation rendered — not recomputed policy. The server rejects a
 * plan that does not sum to 1.0000 on save, so anything other than 100% here means the data
 * predates that rule and the reader needs to see it, not have it hidden.
 */
function SummaryStrip({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial.paymentScheduleTab');
  const locale = useLocale() as 'en' | 'ar';
  const query = useCommercialCurrentCycle(projectId);

  if (query.isPending) return <Skeleton className="h-20 w-full" />;

  const schedule = query.data?.paymentSchedule ?? null;
  const installments = schedule?.installments ?? [];
  const totalFraction = installments.reduce((sum, i) => sum + Number(i.percentage), 0);
  const reconciled = installments.length > 0 && Math.abs(totalFraction - 1) < 0.00005;

  const contractValue = schedule?.contractValue ?? summary.contractValue?.originalContractValue ?? null;
  const money =
    contractValue === null
      ? summary.financialsVisible
        ? t('valueNotSet')
        : t('restricted')
      : (formatMoney(contractValue, schedule?.currency ?? summary.currency, locale) ?? '—');

  return (
    <section className="rounded-panel border border-border bg-surface px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarClock size={18} className="text-brand-primary" aria-hidden="true" />
            <h2 className="text-body font-semibold text-foreground">{t('title')}</h2>
          </div>
          <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div className="text-end">
            <dt className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {t('contractValue')}
            </dt>
            <dd className="mt-0.5 text-body font-semibold tabular-nums text-foreground">{money}</dd>
          </div>
          <div className="text-end">
            <dt className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {t('planTotal')}
            </dt>
            <dd
              className={cn(
                'mt-0.5 text-body font-semibold tabular-nums',
                installments.length === 0
                  ? 'text-muted-foreground'
                  : reconciled
                    ? 'text-success'
                    : 'text-warning',
              )}
            >
              {installments.length === 0 ? '—' : formatSchedulePercent(String(totalFraction))}
            </dd>
          </div>
        </dl>
      </div>

      {installments.length > 0 && !reconciled ? (
        <p className="mt-3 text-caption text-warning">{t('notReconciled')}</p>
      ) : null}
    </section>
  );
}

/**
 * The DRAFT-only schedule editor (commercial-billing-model-refinement §5 P2).
 *
 * Editability is the server's rule mirrored: the whole plan is freely re-profiled while the
 * contract is DRAFT, and once committed a schedule is changed only through a Variation (the server
 * 409s any edit). On a non-DRAFT contract the editor is replaced with that explanation rather than
 * a disabled form — there is nothing to do here, and offering a control the server refuses is worse
 * than saying why it is gone. ACTIVE re-profiling (spec Q-B) is intentionally not built.
 */
function ScheduleEditor({
  projectId,
  contractId,
  status,
}: {
  projectId: string;
  contractId: string;
  status: string;
}) {
  const t = useTranslations('commercial.paymentScheduleTab');
  const { can } = usePermissions();
  const [isEditing, setIsEditing] = useState(false);

  const canManage = can('manage:contract');
  const isDraft = status === 'DRAFT';

  // Committed schedule: the server refuses edits (409). Say so plainly and route to the real path.
  if (!isDraft) {
    return (
      <SectionCard title={t('editorTitle')}>
        <p className="py-1 text-body-sm text-muted-foreground">{t('reprofileNote')}</p>
      </SectionCard>
    );
  }

  if (!canManage) {
    return (
      <SectionCard title={t('editorTitle')}>
        <p className="py-1 text-body-sm text-muted-foreground">{t('noPermission')}</p>
      </SectionCard>
    );
  }

  if (!isEditing) {
    return (
      <SectionCard
        title={t('editorTitle')}
        action={
          <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
            <Pencil size={15} aria-hidden="true" /> {t('edit')}
          </Button>
        }
      >
        <p className="py-1 text-body-sm text-muted-foreground">{t('draftHint')}</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={t('editorTitle')} bodyClassName="px-4 py-4 sm:px-5">
      <ScheduleForm
        projectId={projectId}
        contractId={contractId}
        onDone={() => setIsEditing(false)}
      />
    </SectionCard>
  );
}

/** The editor form's values — only the payment plan matters, but `PlanRowFields` types the whole shape. */
type EditorValues = Pick<ContractFormValues, 'billingModel' | 'paymentPlan'>;

function ScheduleForm({
  projectId,
  contractId,
  onDone,
}: {
  projectId: string;
  contractId: string;
  onDone: () => void;
}) {
  const t = useTranslations('commercial.paymentScheduleTab');
  const tPlan = useTranslations('platform.contracts.create');
  const tCommon = useTranslations('common');
  const save = useReplacePaymentPlan(projectId, contractId);

  // The plan validation, mirrored from the create form (ADR-023 CONST-COM-012): every row needs a
  // name, a positive ≤2-dp percent, a TIME_BASED row needs a day offset, and the whole plan must
  // total 100%. The replace-all route needs at least one installment (ArrayMinSize(1)).
  const schema = z.object({
    billingModel: z.string(),
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
  } = useForm<EditorValues>({
    resolver: zodResolver(
      schema.superRefine((values, ctx) => {
        if (values.paymentPlan.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['paymentPlan'],
            message: tPlan('plan.empty'),
          });
          return;
        }
        values.paymentPlan.forEach((row, i) => {
          if (!row.name.trim()) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentPlan', i, 'name'], message: tPlan('plan.nameRequired') });
          }
          const pct = row.percentage.trim();
          if (!/^\d+(\.\d{1,2})?$/.test(pct) || Number(pct) <= 0) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentPlan', i, 'percentage'], message: tPlan('plan.percentInvalid') });
          }
          if (row.triggerType === PaymentTrigger.TIME_BASED && !row.dueOffsetDays.trim()) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentPlan', i, 'dueOffsetDays'], message: tPlan('plan.offsetRequired') });
          }
        });
        const total = paymentPlanTotalPercent(values.paymentPlan);
        if (Math.abs(total - 100) > 0.001) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentPlan'], message: tPlan('plan.totalMismatch', { total }) });
        }
      }),
    ),
    // Start from a single blank row — the current plan is not repopulated (the read model returns
    // fractions and derived status, not the editable form shape), so re-profiling is a fresh write.
    // The ACCO template and Add-installment cover the common paths.
    defaultValues: { billingModel: 'MILESTONE', paymentPlan: [{ ...EMPTY_PAYMENT_PLAN_ROW }] },
  });

  const { fields, append, remove, replace } = useFieldArray({ control, name: 'paymentPlan' });

  // The live running total drives the reconciliation indicator — the same 100% guard the create
  // builder shows, so a re-profile is checked as it is typed, not only on submit.
  const planRows = useWatch({ control, name: 'paymentPlan' }) ?? [];
  const total = paymentPlanTotalPercent(planRows);
  const balanced = planRows.length > 0 && Math.abs(total - 100) <= 0.001;

  const onSubmit = (values: EditorValues) => {
    save.mutate(buildPaymentPlan(values.paymentPlan), { onSuccess: onDone });
  };

  const planError =
    typeof errors.paymentPlan?.message === 'string' ? errors.paymentPlan.message : undefined;

  const serverError = save.isError
    ? save.error instanceof ApiError && save.error.messages.length > 0
      ? save.error.message
      : t('saveFailed')
    : null;

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      className="space-y-4"
      noValidate
    >
      {serverError ? <Alert variant="error" messages={[serverError]} /> : null}
      {planError ? <Alert variant="error" messages={[planError]} /> : null}

      <FormSection title={tPlan('plan.title')}>
        <p className="text-xs text-muted-foreground">{tPlan('plan.subtitle')}</p>

        <ul className="mt-3 space-y-3">
          {fields.map((field, index) => (
            <PlanRowFields
              key={field.id}
              index={index}
              control={control as never}
              register={register as never}
              errors={errors as never}
              onRemove={() => remove(index)}
              t={tPlan}
            />
          ))}
        </ul>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => append({ ...EMPTY_PAYMENT_PLAN_ROW })}>
              <Plus size={16} aria-hidden="true" /> {tPlan('plan.add')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => replace(ACCO_STANDARD_PLAN.map((row) => ({ ...row })))}
            >
              {tPlan('plan.useAccoStandard')}
            </Button>
          </div>
          {planRows.length > 0 ? (
            <p
              className={`text-sm font-medium ${balanced ? 'text-success' : 'text-danger'}`}
              aria-live="polite"
            >
              {balanced ? tPlan('plan.totalOk') : tPlan('plan.total', { total })}
            </p>
          ) : null}
        </div>
      </FormSection>

      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? tCommon('loading') : t('save')}
        </Button>
        <Button type="button" variant="outline" onClick={onDone} disabled={save.isPending}>
          {tCommon('cancel')}
        </Button>
      </div>
    </form>
  );
}

/** Rates arrive as fractions — `0.4000` is 40%. Local copy to keep the tab self-contained. */
function formatSchedulePercent(fraction: string): string {
  const n = Number(fraction);
  if (!Number.isFinite(n)) return fraction;
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 }).format(n);
}
