'use client';

import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarClock, Lock, Pencil } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type {
  CommercialPaymentScheduleInstallment,
  CommercialSummaryResponse,
} from '@erp/types';
import { Alert, Button, FormSection, Skeleton, cn } from '@erp/ui';

import { EmptyState } from '@/components/empty-state';
import { usePermissions } from '@/features/auth/permissions/can';
import {
  buildPaymentPlan,
  EMPTY_PAYMENT_PLAN_ROW,
  paymentPlanRowFromInstallment,
  paymentPlanTotalPercent,
  type ContractFormValues,
  type PaymentPlanRow,
} from '@/features/contracts/contract-form-payload';
import { LockedPlanRow } from '@/features/contracts/components/payment-plan-fields';
import { PaymentPlanBuilder } from '@/features/contracts/components/payment-plan-builder';
import { ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';

import { useCommercialCurrentCycle } from '../hooks/use-commercial';
import { useReplacePaymentPlan } from '../hooks/use-replace-payment-plan';
import { isBilledInstallment } from '../presentation';
import { CommercialActivity } from './commercial-activity';
import { PaymentSchedulePanel } from './payment-schedule-panel';
import { AttentionList, SectionCard } from './commercial-ui';

/**
 * Split the current schedule into the two halves Q-B treats differently:
 *
 *  - `frozen`   — already-invoiced installments (PAID / PARTIALLY_PAID / BILLED). The server holds
 *                 these fixed; the UI shows them as locked rows and never submits them.
 *  - `editable` — un-invoiced installments (NEXT / UPCOMING), pre-populated as the editable form.
 *
 * The order is the plan's own `sortOrder` so a re-profile reads top-to-bottom the way the ledger does.
 */
export function splitScheduleForEditing(installments: CommercialPaymentScheduleInstallment[]): {
  frozen: CommercialPaymentScheduleInstallment[];
  editable: CommercialPaymentScheduleInstallment[];
} {
  const ordered = [...installments].sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    frozen: ordered.filter((i) => isBilledInstallment(i.status)),
    editable: ordered.filter((i) => !isBilledInstallment(i.status)),
  };
}

/**
 * The frozen invoiced share, as a whole-percent rounded to 2 dp — the amount the editable rows must
 * make up to 100. Percentages arrive as 0..1 fractions, so this sums fractions then scales; the 2-dp
 * round mirrors the form's own percent precision so `frozen + editable` compares cleanly to 100.
 */
export function frozenPercentTotal(frozen: CommercialPaymentScheduleInstallment[]): number {
  const fraction = frozen.reduce((sum, i) => sum + Number(i.percentage), 0);
  return Number((fraction * 100).toFixed(2));
}

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

      {/* The interim CurrentPaymentCycle card C2 relocated here is gone (S-SH-2): the persistent
          cycle ribbon in the workspace shell now carries "what happens next to get paid" across all
          four tabs, so keeping a per-tab copy would duplicate the cue and let the two drift. */}

      {/* The ledger + generate-invoice + link-milestone + CONST-COM-011 gate, reused verbatim. */}
      <PaymentSchedulePanel projectId={projectId} contractId={contract.id} summary={summary} />

      <ScheduleEditor projectId={projectId} contractId={contract.id} status={contract.status} />

      {/* Attention + activity also lived on Overview. They stay reachable here so nothing
          disappears before C3/C8 give them permanent homes. */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <SectionCard title={t('overview.attention')}>
          <AttentionList items={summary.attention} />
        </SectionCard>
        <CommercialActivity items={summary.recentActivity} />
      </div>
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
 * The payment-schedule editor (commercial-billing-model-refinement §5 P2 + spec Q-B).
 *
 * Editability mirrors the server's rule (`PUT /contracts/:id/payment-plan`, DRAFT | ACTIVE):
 *
 *  - DRAFT — nothing is invoiced, so the whole plan is re-profiled and must total 100%.
 *  - ACTIVE — the already-invoiced installments are FROZEN (Q-B). They render as locked rows the user
 *    cannot touch; only the un-invoiced tail is a form, pre-populated from the current plan, and it
 *    must make the schedule reconcile to 100% again (`editable = 100 − frozen%`). The save submits
 *    ONLY the editable rows; the server keeps the frozen ones. Changing the contract value or an
 *    already-invoiced stage still needs a Variation.
 *
 * A terminal / locked contract (CLOSED, CANCELLED, TERMINATED, FINAL_ACCOUNT_PENDING) is neither:
 * the schedule is fixed and only a Variation reprofiles it, so the editor is replaced with that
 * explanation rather than a control the server would 409.
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
  const cycle = useCommercialCurrentCycle(projectId);
  const [isEditing, setIsEditing] = useState(false);

  const canManage = can('manage:contract');
  const isDraft = status === 'DRAFT';
  const isActive = status === 'ACTIVE';
  const isReprofile = isActive; // ACTIVE = re-profile the un-invoiced tail; DRAFT = full replace.

  // Neither DRAFT nor ACTIVE: the server refuses edits. Say so plainly and route to the real path.
  if (!isDraft && !isActive) {
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

  // The editor needs the current plan to pre-populate (and, on ACTIVE, to split off the frozen rows).
  if (cycle.isPending) {
    return (
      <SectionCard title={t('editorTitle')}>
        <Skeleton className="h-24 w-full" />
      </SectionCard>
    );
  }

  const schedule = cycle.data?.paymentSchedule ?? null;
  const installments = schedule?.installments ?? [];
  const contractValue = schedule?.contractValue ?? null;
  const currency = schedule?.currency ?? 'USD';
  const { frozen, editable } = splitScheduleForEditing(installments);

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
        <p className="py-1 text-body-sm text-muted-foreground">
          {isReprofile ? t('reprofileHint') : t('draftHint')}
        </p>
        {isReprofile ? (
          <p className="mt-2 flex items-start gap-2 text-caption text-muted-foreground">
            <Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{t('variationNote')}</span>
          </p>
        ) : null}
      </SectionCard>
    );
  }

  return (
    <SectionCard title={t('editorTitle')} bodyClassName="px-4 py-4 sm:px-5">
      <ScheduleForm
        projectId={projectId}
        contractId={contractId}
        isReprofile={isReprofile}
        frozen={frozen}
        editable={editable}
        contractValue={contractValue}
        currency={currency}
        onDone={() => setIsEditing(false)}
      />
    </SectionCard>
  );
}

/** The editor form's values — only the payment plan matters, but `PlanRowFields` types the whole shape. */
type EditorValues = Pick<ContractFormValues, 'billingModel' | 'paymentPlan'>;

/**
 * Seed the editable field array from the current plan.
 *
 * DRAFT and ACTIVE both open pre-populated from the un-invoiced installments so the user adjusts the
 * existing tail, not a blank slate. A brand-new DRAFT with no plan yet still needs something to type
 * into, so it falls back to a single blank row (the ACCO template and Add cover the rest).
 */
function seedEditableRows(editable: CommercialPaymentScheduleInstallment[]): PaymentPlanRow[] {
  if (editable.length === 0) return [{ ...EMPTY_PAYMENT_PLAN_ROW }];
  return editable.map((i) => paymentPlanRowFromInstallment(i));
}

function ScheduleForm({
  projectId,
  contractId,
  isReprofile,
  frozen,
  editable,
  contractValue,
  currency,
  onDone,
}: {
  projectId: string;
  contractId: string;
  /** ACTIVE: frozen invoiced rows are shown locked and the editable tail totals `100 − frozen%`. */
  isReprofile: boolean;
  frozen: CommercialPaymentScheduleInstallment[];
  editable: CommercialPaymentScheduleInstallment[];
  /** The contract value the percents are a share of, for the builder's live money cells. */
  contractValue: string | null;
  currency: string;
  onDone: () => void;
}) {
  const t = useTranslations('commercial.paymentScheduleTab');
  const tPlan = useTranslations('platform.contracts.create');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const save = useReplacePaymentPlan(projectId, contractId);

  // The frozen invoiced share the editable rows must make up to 100. On DRAFT this is 0, so the
  // target collapses to today's 100% rule.
  const frozenPercent = frozenPercentTotal(frozen);
  const targetPercent = Number((100 - frozenPercent).toFixed(2));

  // The plan validation, mirrored from the create form (ADR-023 CONST-COM-012): every row needs a
  // name and a positive ≤2-dp percent, and the editable rows must total `targetPercent`. The trigger
  // is derived on save (no field to validate), and the replace-all route needs at least one row.
  const schema = z.object({
    billingModel: z.string(),
    paymentPlan: z.array(
      z.object({
        name: z.string(),
        percentage: z.string(),
        isAdvance: z.boolean(),
        dueDate: z.string(),
      }),
    ),
  });

  const {
    control,
    register,
    setValue,
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
        });
        const total = paymentPlanTotalPercent(values.paymentPlan);
        if (Math.abs(total - targetPercent) > 0.001) {
          // On ACTIVE the target is the un-invoiced remainder; say so, not "100%".
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['paymentPlan'],
            message: isReprofile
              ? t('editableMismatch', { total, target: targetPercent })
              : tPlan('plan.totalMismatch', { total }),
          });
        }
      }),
    ),
    // Pre-populate from the current un-invoiced tail so the user adjusts the existing plan.
    defaultValues: { billingModel: 'MILESTONE', paymentPlan: seedEditableRows(editable) },
  });

  // The live running total hard-stops Save exactly as the server's `assertPaymentPlanReconciles`
  // does — the editable rows plus the frozen invoiced share must equal 100%, i.e. the editable rows
  // must equal `targetPercent`. The builder shows the live delta; this drives the Save button.
  const planRows = useWatch({ control, name: 'paymentPlan' }) ?? [];
  const total = paymentPlanTotalPercent(planRows);
  const delta = Number((targetPercent - total).toFixed(2));
  const balanced = planRows.length > 0 && Math.abs(delta) <= 0.001;

  const onSubmit = (values: EditorValues) => {
    // Submit ONLY the editable rows; the server keeps the frozen invoiced installments (Q-B). The
    // advance is only row 0 when there is no frozen head (a DRAFT full-replace); on a re-profile the
    // advance is already invoiced and frozen, so the editable tail is entirely milestones.
    save.mutate(buildPaymentPlan(values.paymentPlan, frozen.length === 0), { onSuccess: onDone });
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

      {isReprofile ? (
        <Alert variant="info" messages={[t('lockedStagesNote')]} />
      ) : null}

      {/* Frozen invoiced stages: shown so the user sees the whole plan, but locked and never submitted. */}
      {frozen.length > 0 ? (
        <FormSection title={t('frozenSectionTitle')}>
          {/* S-PS-3: state up front how much is already billed and what remains editable, so the
              locked rows below are read as "the past" and the target the editable tail must hit is
              obvious. `targetPercent` is exactly 100 − frozen%, the un-invoiced remainder. */}
          <p className="text-body-sm font-medium text-foreground">
            {t('alreadyBilledHeader', { billed: frozenPercent, remaining: targetPercent })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t('frozenSectionHint')}</p>
          <ul className="mt-3 space-y-3">
            {frozen.map((inst) => (
              <LockedPlanRow
                key={inst.id}
                name={inst.name}
                percentLabel={formatSchedulePercent(inst.percentage)}
                statusLabel={t(`installmentStatus.${inst.status}`)}
                lockedLabel={t('locked')}
              />
            ))}
          </ul>
        </FormSection>
      ) : null}

      <FormSection title={isReprofile ? t('editableSectionTitle') : tPlan('plan.title')}>
        <p className="text-xs text-muted-foreground">
          {isReprofile ? t('editableSectionHint', { target: targetPercent }) : tPlan('plan.subtitle')}
        </p>

        <div className="mt-3">
          <PaymentPlanBuilder
            control={control as never}
            register={register as never}
            setValue={setValue as never}
            errors={errors as never}
            t={tPlan}
            contractValue={contractValue}
            currency={currency}
            locale={locale}
            targetPercent={targetPercent}
            frozenPercent={frozenPercent}
            allowAdvance={frozen.length === 0}
            showAccoStandard={!isReprofile}
          />
        </div>
      </FormSection>

      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
        {/* S-PS-2 / CONST-COM-024: Save is hard-stopped whenever the editable rows do not reconcile
            to the required total (100% DRAFT; 100 − invoiced% ACTIVE). This mirrors the server's
            `assertPaymentPlanReconciles` so a broken plan never reaches the wire; the live delta in
            the builder says how far off it is, and the server error remains the backstop. */}
        <Button type="submit" disabled={save.isPending || !balanced}>
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
