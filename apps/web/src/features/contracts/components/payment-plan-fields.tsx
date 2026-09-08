'use client';

import {
  Controller,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from 'react-hook-form';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PaymentTrigger } from '@erp/types';
import { Button, FormField, Input, Select } from '@erp/ui';

import type { ContractFormValues, PaymentPlanRow } from '../contract-form-payload';

/**
 * The trigger options a payment-plan row offers, in the create form's order. Shared by the
 * create-time builder and the DRAFT-only editor on the Payment Schedule tab so the two stay
 * identical (a divergence would let one surface offer a trigger the other refuses).
 */
export const PAYMENT_TRIGGERS = [
  PaymentTrigger.MILESTONE,
  PaymentTrigger.ADVANCE,
  PaymentTrigger.TIME_BASED,
] as const;

/**
 * ACCO's canonical milestone schedule (commercial-billing-model-refinement §4.2): Structure 40%
 * paid as the ADVANCE, then three MILESTONE stages of 30/20/10 that sum to 100%. Offered as a
 * one-click quick-fill so a user profiling a milestone contract does not retype the house standard.
 *
 * A plain data constant so both the create builder and the tab editor seed the exact same rows;
 * the `%` are whole percents (the form's on-screen unit) and reconcile to 100 via
 * `paymentPlanTotalPercent`.
 */
export const ACCO_STANDARD_PLAN: PaymentPlanRow[] = [
  { name: 'Structure', percentage: '40', triggerType: PaymentTrigger.ADVANCE, milestoneLabel: '', dueOffsetDays: '' },
  { name: 'Partition & Plastering', percentage: '30', triggerType: PaymentTrigger.MILESTONE, milestoneLabel: '', dueOffsetDays: '' },
  { name: 'Installation & Paint', percentage: '20', triggerType: PaymentTrigger.MILESTONE, milestoneLabel: '', dueOffsetDays: '' },
  { name: 'Inspection & Handover', percentage: '10', triggerType: PaymentTrigger.MILESTONE, milestoneLabel: '', dueOffsetDays: '' },
];

/**
 * One payment-plan installment row. Extracted from the contract form so both the create-time
 * builder and the DRAFT-only Payment Schedule editor render an identical row — a copy-paste would
 * let the two drift on validation, trigger set, or field order.
 *
 * Each row watches its own trigger so a TIME_BASED installment shows a day-offset field and
 * everything else shows the free-text milestone label, without re-rendering the whole form.
 */
export function PlanRowFields({
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
          <Controller
            control={control}
            name={`paymentPlan.${index}.triggerType`}
            render={({ field }) => (
              <Select
                id={`plan-${index}-trigger`}
                value={field.value}
                onChange={field.onChange}
              >
                {PAYMENT_TRIGGERS.map((tr) => (
                  <option key={tr} value={tr}>
                    {t(`plan.triggerType.${tr}`)}
                  </option>
                ))}
              </Select>
            )}
          />
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
