'use client';

import {
  useFieldArray,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormRegister,
  type UseFormSetValue,
} from 'react-hook-form';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@erp/ui';

import { formatMoney } from '@/lib/format';

import { ACCO_STANDARD_PLAN, PlanRowFields } from './payment-plan-fields';
import {
  EMPTY_PAYMENT_PLAN_ROW,
  installmentAmount,
  paymentPlanTotalPercent,
  type ContractFormValues,
} from '../contract-form-payload';

/**
 * The shared payment-schedule builder (ADR-030 payment-schedule redesign).
 *
 * Rows + Add + the ACCO-standard quick-fill + a live money/reconciliation footer, extracted so the
 * contract-create form and the Payment Schedule tab render the SAME thing — a divergence would let
 * one surface validate or classify differently from the other. The builder is layout-neutral (it
 * renders no section chrome); the parent wraps it in a `FormSection` with the right title and owns
 * the `useForm`, the submit button, and its own hard-stop on `balanced`.
 *
 * Money is indicative only: each row shows `percent × contractValue`, and the footer sums them and
 * states the running total against the target — the server computes the authoritative figure from
 * the frozen base at billing time. The % reconciliation is the real gate: the total must equal
 * `targetPercent` (100 on a create / DRAFT full-replace, `100 − frozen%` on an ACTIVE re-profile).
 */
export function PaymentPlanBuilder({
  control,
  register,
  setValue,
  errors,
  t,
  contractValue,
  currency,
  locale,
  targetPercent,
  frozenPercent = 0,
  allowAdvance,
  showAccoStandard,
}: {
  control: Control<ContractFormValues>;
  register: UseFormRegister<ContractFormValues>;
  setValue: UseFormSetValue<ContractFormValues>;
  errors: FieldErrors<ContractFormValues>;
  /** Bound to `platform.contracts.create` — the shared `plan.*` strings. */
  t: ReturnType<typeof useTranslations>;
  contractValue: string | number | null;
  currency: string | null | undefined;
  locale: 'en' | 'ar';
  /** The percent the editable rows must total (100, or 100 − already-billed% on a re-profile). */
  targetPercent: number;
  /** Already-billed share on an ACTIVE re-profile; drives the "N% already billed" footer note. */
  frozenPercent?: number;
  /** Whether the advance may be designated on this plan (false on a frozen ACTIVE re-profile). */
  allowAdvance: boolean;
  /** Offer the ACCO 40/30/20/10 one-click fill (create / DRAFT only — it is a full 100% plan). */
  showAccoStandard: boolean;
}) {
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'paymentPlan' });
  const rows = useWatch({ control, name: 'paymentPlan' }) ?? [];

  // The advance is a single choice across the plan: designating one stage clears the flag on every
  // other row (radio-across-rows), so at most one row is ever the advance; unticking leaves zero,
  // which is valid for a no-advance contract. Uses `setValue` (no field remount, keeps focus/values).
  const designateAdvance = (index: number, makeAdvance: boolean) => {
    if (!makeAdvance) {
      setValue(`paymentPlan.${index}.isAdvance`, false, { shouldDirty: true });
      return;
    }
    fields.forEach((_, r) => {
      setValue(`paymentPlan.${r}.isAdvance`, r === index, { shouldDirty: true });
    });
  };

  // Mirrors the server's `assertPaymentPlanReconciles`: the rows must total the target exactly. The
  // parent hard-stops Save on the same check; this drives the live footer as the user types.
  const total = paymentPlanTotalPercent(rows);
  const delta = Number((targetPercent - total).toFixed(2));
  const balanced = rows.length > 0 && Math.abs(delta) <= 0.001;

  const allocated = rows.reduce(
    (sum, row) => sum + (installmentAmount(row?.percentage ?? '', contractValue) ?? 0),
    0,
  );
  const allocatedLabel = formatMoney(allocated, currency, locale) ?? '—';
  const totalLabel = formatMoney(contractValue, currency, locale);

  const statusMsg = balanced
    ? t('plan.reconciledOk', { target: targetPercent })
    : delta > 0
      ? t('plan.reconcileShort', { total, amount: Number(delta.toFixed(2)) })
      : t('plan.reconcileOver', { total, amount: Number(Math.abs(delta).toFixed(2)) });

  return (
    <div>
      <ul className="space-y-3">
        {fields.map((field, index) => (
          <PlanRowFields
            key={field.id}
            index={index}
            control={control}
            register={register}
            errors={errors}
            onRemove={() => remove(index)}
            t={t}
            isAdvance={allowAdvance && Boolean(rows[index]?.isAdvance)}
            allowAdvance={allowAdvance}
            onTypeChange={(adv) => designateAdvance(index, adv)}
            contractValue={contractValue}
            currency={currency}
            locale={locale}
          />
        ))}
      </ul>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ ...EMPTY_PAYMENT_PLAN_ROW })}
          >
            <Plus size={16} aria-hidden="true" /> {t('plan.add')}
          </Button>
          {showAccoStandard ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => replace(ACCO_STANDARD_PLAN.map((row) => ({ ...row })))}
            >
              {t('plan.useAccoStandard')}
            </Button>
          ) : null}
        </div>

        {rows.length > 0 ? (
          <div className="text-end" aria-live="polite">
            <p className="text-caption text-muted-foreground">
              {totalLabel
                ? t('plan.allocatedOf', { allocated: allocatedLabel, total: totalLabel })
                : t('plan.allocated', { allocated: allocatedLabel })}
              {frozenPercent > 0
                ? ` · ${t('plan.reprofileContext', { billed: frozenPercent, target: targetPercent })}`
                : ''}
            </p>
            <p className={cn('text-sm font-medium', balanced ? 'text-success' : 'text-danger')}>
              {statusMsg}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
