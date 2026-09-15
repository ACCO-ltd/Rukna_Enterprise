'use client';

import {
  Controller,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from 'react-hook-form';
import { Lock, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, Button, Checkbox, DatePicker, FormField, Input } from '@erp/ui';

import { formatMoney } from '@/lib/format';

import {
  installmentAmount,
  type ContractFormValues,
  type PaymentPlanRow,
} from '../contract-form-payload';

/**
 * ACCO's canonical milestone schedule (commercial-billing-model-refinement §4.2): Structure 40%
 * paid as the advance, then three stages of 30/20/10 that sum to 100%. Offered as a one-click
 * quick-fill so a user profiling a milestone contract does not retype the house standard.
 *
 * A plain data constant so both the create builder and the tab editor seed the exact same rows;
 * the `%` are whole percents (the form's on-screen unit) and reconcile to 100 via
 * `paymentPlanTotalPercent`. The house standard marks the Structure stage as the advance
 * (`isAdvance`); the user can re-designate which stage is the advance, so this is only the default.
 */
export const ACCO_STANDARD_PLAN: PaymentPlanRow[] = [
  { name: 'Structure', percentage: '40', isAdvance: true, dueDate: '' },
  { name: 'Partition & Plastering', percentage: '30', isAdvance: false, dueDate: '' },
  { name: 'Installation & Paint', percentage: '20', isAdvance: false, dueDate: '' },
  { name: 'Inspection & Handover', percentage: '10', isAdvance: false, dueDate: '' },
];

/**
 * One payment-plan installment row (ADR-030 payment-schedule redesign). Extracted from the contract
 * form so both the create-time builder and the Payment Schedule editor render an identical row — a
 * copy-paste would let the two drift on validation, field set, or order.
 *
 * The row is deliberately spare: a stage **name**, a **percent**, the **money** that percent is of
 * (live, read-only), an optional **due date**, and a single **Advance** checkbox that classifies the
 * stage. There is no trigger picker and no milestone-label field — ACCO bills only on verified
 * stages, and the stage name is its own label. Exactly one stage may be the advance (the builder
 * enforces the single-choice by clearing the others); when `allowAdvance` is false — an ACTIVE
 * re-profile whose advance is already frozen — the row is a plain milestone with no control.
 */
export function PlanRowFields({
  index,
  control,
  register,
  errors,
  onRemove,
  t,
  isAdvance,
  allowAdvance,
  onTypeChange,
  contractValue,
  currency,
  locale,
}: {
  index: number;
  control: Control<ContractFormValues>;
  register: UseFormRegister<ContractFormValues>;
  errors: FieldErrors<ContractFormValues>;
  onRemove: () => void;
  t: ReturnType<typeof useTranslations>;
  /** Whether this stage is currently the advance. */
  isAdvance: boolean;
  /** Whether the advance may be (re)designated on this plan at all (false on a frozen re-profile). */
  allowAdvance: boolean;
  /** Designate/undesignate this stage as the advance; the builder clears the others. */
  onTypeChange: (isAdvance: boolean) => void;
  /** The contract value the percent is a share of, for the live money cell. Null → dash. */
  contractValue: string | number | null;
  currency: string | null | undefined;
  locale: 'en' | 'ar';
}) {
  const rowErrors = errors.paymentPlan?.[index];
  // Watch this row's percent so the money cell tracks it as the user types.
  const percent = useWatch({ control, name: `paymentPlan.${index}.percentage` }) ?? '';
  const amount = installmentAmount(percent, contractValue);
  const amountLabel = amount === null ? '—' : (formatMoney(amount, currency, locale) ?? '—');

  return (
    <li className="rounded-panel border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        {/* The advance/milestone classification. When the advance can be designated it is a single
            checkbox (ticking one clears the others in the builder); otherwise a plain milestone tag. */}
        {allowAdvance ? (
          <label className="inline-flex cursor-pointer items-center gap-2 text-body-sm font-medium text-foreground">
            <Checkbox
              checked={isAdvance}
              onChange={(e) => onTypeChange(e.target.checked)}
              aria-label={t('plan.advanceTag')}
            />
            <span className={isAdvance ? 'text-brand-primary' : 'text-muted-foreground'}>
              {isAdvance ? t('plan.advanceTag') : t('plan.milestoneTag')}
            </span>
          </label>
        ) : (
          <Badge tone="neutral">{t('plan.milestoneTag')}</Badge>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 size={15} aria-hidden="true" /> {t('plan.remove')}
        </Button>
      </div>

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

        {/* The live money the percent works out to — read-only; the server owns the authoritative
            figure at billing time, so this is labelled as indicative by the builder footer. */}
        <FormField htmlFor={`plan-${index}-amount`} label={t('plan.amount')}>
          <div
            id={`plan-${index}-amount`}
            className="flex min-h-11 items-center rounded-control border border-border bg-muted/40 px-3 text-body-sm font-medium tabular-nums text-foreground"
          >
            {amountLabel}
          </div>
        </FormField>

        <FormField htmlFor={`plan-${index}-due`} label={t('plan.dueDate')}>
          <Controller
            control={control}
            name={`paymentPlan.${index}.dueDate`}
            render={({ field }) => (
              <DatePicker id={`plan-${index}-due`} value={field.value} onChange={field.onChange} />
            )}
          />
        </FormField>
      </div>
    </li>
  );
}

/**
 * A frozen installment on an ACTIVE contract — one already invoiced (PAID / PARTIALLY_PAID /
 * BILLED), which the server holds fixed (Q-B). Rendered read-only alongside the editable rows so the
 * user sees the whole plan while only the un-invoiced tail is a form: no inputs, no remove control,
 * a lock affordance and a "locked" badge, and its % counts toward 100 but is never submitted.
 *
 * Presentational only — it takes plain values, not form state, because a frozen row is not part of
 * the field array the editable rows bind to.
 */
export function LockedPlanRow({
  name,
  percentLabel,
  statusLabel,
  lockedLabel,
}: {
  name: string;
  /** The row's share, pre-formatted (e.g. "40%"). */
  percentLabel: string;
  /** The installment's bill status, human-readable (e.g. "Invoiced", "Paid"). */
  statusLabel: string;
  /** The "Locked" affordance label. */
  lockedLabel: string;
}) {
  return (
    <li className="rounded-panel border border-border border-dashed bg-muted/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Lock size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 truncate font-medium text-foreground">{name}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="tabular-nums text-muted-foreground">{percentLabel}</span>
          <Badge tone="historical">{statusLabel}</Badge>
          <span className="text-caption uppercase tracking-[0.06em] text-muted-foreground">
            {lockedLabel}
          </span>
        </div>
      </div>
    </li>
  );
}
