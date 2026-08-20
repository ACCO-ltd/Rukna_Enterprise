'use client';

import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  FormField,
  Input,
  MoneyInput,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { toDecimalString } from '@/features/contracts/contract-form-payload';
import { fractionToPercent, percentToFraction } from '@/features/contracts/contract-terms';
import type { ContractDetail } from '@/features/contracts/types';
import { formatMoney } from '@/lib/format';

import { useAddIpaDeduction, useRemoveIpaDeduction } from '../hooks/use-ipa';
import type { IpaDeduction } from '../types';

interface IpaDeductionsPanelProps {
  ipaId: string;
  deductions: IpaDeduction[];
  /** The gross period total, offered as the default basis. */
  periodTotal: string;
  currency: string;
  contract: ContractDetail;
  canEdit: boolean;
}

export function IpaDeductionsPanel({
  ipaId,
  deductions,
  periodTotal,
  currency,
  contract,
  canEdit,
}: IpaDeductionsPanelProps) {
  const t = useTranslations('platform.ipa.deductions');
  const locale = useLocale() as 'en' | 'ar';
  const [isAdding, setIsAdding] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<IpaDeduction | null>(null);

  const remove = useRemoveIpaDeduction(ipaId);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>
        {canEdit ? (
          <Button
            size="sm"
            onClick={() => {
              setIsAdding(true);
            }}
          >
            {t('add')}
          </Button>
        ) : null}
      </div>

      {deductions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t('none')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('noneHint')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {deductions.map((deduction) => (
            <li
              key={deduction.id}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{deduction.deductionType}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <bdi>{formatMoney(deduction.basis, currency, locale)}</bdi>
                  {deduction.rate ? (
                    <>
                      {' × '}
                      <bdi>{fractionToPercent(deduction.rate)}%</bdi>
                    </>
                  ) : null}
                </p>
              </div>
              <p className="text-sm font-semibold text-foreground">
                <bdi>{formatMoney(deduction.amount, currency, locale)}</bdi>
              </p>
              {canEdit ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPendingRemoval(deduction);
                  }}
                >
                  {t('remove')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {isAdding ? (
        <AddDeductionDialog
          ipaId={ipaId}
          periodTotal={periodTotal}
          currency={currency}
          contract={contract}
          onClose={() => {
            setIsAdding(false);
          }}
        />
      ) : null}

      {pendingRemoval ? (
        <ConfirmActionDialog
          title={t('removeTitle')}
          description={t('removeBody')}
          confirmLabel={t('remove')}
          isPending={remove.isPending}
          errorMessage={remove.isError ? t('removeFailed') : undefined}
          onConfirm={() => {
            remove.mutate(pendingRemoval.id, {
              onSuccess: () => {
                setPendingRemoval(null);
              },
            });
          }}
          onDismiss={() => {
            remove.reset();
            setPendingRemoval(null);
          }}
        />
      ) : null}
    </section>
  );
}

interface DeductionFormValues {
  deductionType: string;
  basis: string;
  rate: string;
  amount: string;
}

function AddDeductionDialog({
  ipaId,
  periodTotal,
  currency,
  contract,
  onClose,
}: {
  ipaId: string;
  periodTotal: string;
  currency: string;
  contract: ContractDetail;
  onClose: () => void;
}) {
  const t = useTranslations('platform.ipa.deductions');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const add = useAddIpaDeduction(ipaId);

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DeductionFormValues>({
    // Basis defaults to the period total, which is what the DTO describes it as. The
    // amount is left empty on purpose — see the note below.
    defaultValues: { deductionType: '', basis: periodTotal, rate: '', amount: '' },
  });

  const basis = useWatch({ control, name: 'basis' });
  const rate = useWatch({ control, name: 'rate' });

  /**
   * The arithmetic is shown, not applied.
   *
   * `basis` and `amount` are both required by `AddIpaDeductionDto` and the API derives
   * neither, even though the contract's retention and advance-recovery rates are one join
   * away — the same problem as C1 one document later. Rather than silently authoring a
   * money figure, the product of basis and rate is displayed so the person entering it can
   * see and confirm it. The `amount` field stays theirs to fill.
   */
  const preview =
    basis.trim() !== '' &&
    rate.trim() !== '' &&
    Number.isFinite(Number(basis)) &&
    Number.isFinite(Number(rate))
      ? (Number(basis) * (Number(rate) / 100)).toFixed(2)
      : null;

  /** Rates the contract actually agreed, so the entered figure can be checked against them. */
  const contractRates = [
    contract.retentionTerms
      ? t('retentionRate', { rate: fractionToPercent(contract.retentionTerms.retentionRate) })
      : null,
    ...contract.advanceTerms.map((term) =>
      t('recoveryRate', { rate: fractionToPercent(term.recoveryRate) }),
    ),
  ].filter((entry): entry is string => entry !== null);

  const onSubmit = (values: DeductionFormValues) => {
    add.mutate(
      {
        deductionType: values.deductionType.trim(),
        basis: toDecimalString(values.basis),
        ...(values.rate.trim() ? { rate: percentToFraction(values.rate) } : {}),
        amount: toDecimalString(values.amount),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !add.isPending) onClose();
      }}
    >
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (add.isPending) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (add.isPending) e.preventDefault();
        }}
      >
        <DialogTitle>{t('add')}</DialogTitle>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 space-y-4"
          noValidate
        >
          {add.isError ? <Alert variant="error" messages={[t('failed')]} /> : null}

          {/* Said plainly: this amount is stored exactly as typed. Nothing checks it
              against the contract, so the person entering it is the only control. */}
          <Alert variant="warning" messages={[t('authoredHere')]} />

          {contractRates.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('contractRates', { rates: contractRates.join(' · ') })}
            </p>
          ) : null}

          <FormField
            htmlFor="deduction-type"
            label={t('type')}
            error={errors.deductionType?.message}
          >
            <Input
              id="deduction-type"
              aria-describedby="deduction-type-hint"
              aria-invalid={Boolean(errors.deductionType)}
              {...register('deductionType', {
                validate: (v) => v.trim() !== '' || t('typeRequired'),
              })}
            />
            <p id="deduction-type-hint" className="text-xs text-muted-foreground">
              {t('typeHint')}
            </p>
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField htmlFor="deduction-basis" label={t('basis')} error={errors.basis?.message}>
              <Controller
                name="basis"
                control={control}
                rules={{
                  validate: (v) =>
                    (v.trim() !== '' && Number.isFinite(Number(v))) || t('basisRequired'),
                }}
                render={({ field }) => (
                  <MoneyInput
                    id="deduction-basis"
                    aria-describedby="deduction-basis-hint"
                    aria-invalid={Boolean(errors.basis)}
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    name={field.name}
                  />
                )}
              />
              <p id="deduction-basis-hint" className="text-xs text-muted-foreground">
                {t('basisHint')}
              </p>
            </FormField>

            <FormField htmlFor="deduction-rate" label={t('rate')}>
              <Input
                id="deduction-rate"
                inputMode="decimal"
                aria-describedby="deduction-rate-hint"
                {...register('rate')}
              />
              <p id="deduction-rate-hint" className="text-xs text-muted-foreground">
                {t('rateHint')}
              </p>
            </FormField>
          </div>

          <FormField htmlFor="deduction-amount" label={t('amount')} error={errors.amount?.message}>
            <Controller
              name="amount"
              control={control}
              rules={{
                validate: (v) =>
                  (v.trim() !== '' && Number.isFinite(Number(v))) || t('amountRequired'),
              }}
              render={({ field }) => (
                <MoneyInput
                  id="deduction-amount"
                  aria-invalid={Boolean(errors.amount)}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  name={field.name}
                />
              )}
            />
            {preview ? (
              <p className="text-xs text-muted-foreground">
                <bdi>
                  {t('computedHint', {
                    basis: formatMoney(basis, currency, locale) ?? basis,
                    rate,
                    amount: formatMoney(preview, currency, locale) ?? preview,
                  })}
                </bdi>
              </p>
            ) : null}
          </FormField>

          <DialogFooter>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? tCommon('loading') : t('save')}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={add.isPending}>
              {tCommon('cancel')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
