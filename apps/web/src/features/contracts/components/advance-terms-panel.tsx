'use client';

import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useLocale, useTranslations } from 'next-intl';
import { AdvanceType } from '@erp/types';
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
  Select,
} from '@erp/ui';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { formatMoney } from '@/lib/format';

import { toDecimalString } from '../contract-form-payload';
import {
  advanceBasisOf,
  fractionToPercent,
  isValidPercent,
  percentToFraction,
} from '../contract-terms';
import { useAddAdvanceTerm, useRemoveAdvanceTerm } from '../hooks/use-contract-terms';
import type { ContractAdvanceTerm } from '../types';

const ADVANCE_TYPES: AdvanceType[] = [
  AdvanceType.MOBILIZATION,
  AdvanceType.MATERIAL_ON_SITE,
  AdvanceType.EQUIPMENT,
  AdvanceType.OTHER,
];

interface AdvanceTermsPanelProps {
  contractId: string;
  terms: ContractAdvanceTerm[];
  currency: string;
  canEdit: boolean;
}

export function AdvanceTermsPanel({
  contractId,
  terms,
  currency,
  canEdit,
}: AdvanceTermsPanelProps) {
  const t = useTranslations('platform.contracts.terms.advances');
  const locale = useLocale() as 'en' | 'ar';
  const [isAdding, setIsAdding] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<ContractAdvanceTerm | null>(null);

  const remove = useRemoveAdvanceTerm(contractId);

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

      {terms.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t('none')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('noneHint')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {terms.map((term) => {
            const basis = advanceBasisOf(term);
            return (
              <li
                key={term.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {t(`types.${term.advanceType}`)}
                  </p>
                  {term.description ? (
                    <p className="text-xs text-muted-foreground">{term.description}</p>
                  ) : null}
                  {/* Each figure is wrapped in <bdi>. Concatenating a number with Arabic
                      text in one line lets the bidi algorithm treat the trailing `%` as a
                      neutral character and move it to the wrong side — this line rendered
                      "10%" on one side and "%10" on the other before isolation. */}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {/* A term with neither an amount nor a percentage is storable — the DTO
                        enforces no relationship between them — and nothing downstream can
                        price it. Say so rather than rendering a blank. */}
                    <bdi>
                      {basis === 'amount'
                        ? formatMoney(term.amount, currency, locale)
                        : basis === 'percentage'
                          ? `${fractionToPercent(term.percentage)}%`
                          : t('noBasis')}
                    </bdi>
                    {' · '}
                    {t('recoveryRate')}: <bdi>{fractionToPercent(term.recoveryRate)}%</bdi>
                  </p>
                </div>

                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPendingRemoval(term);
                    }}
                  >
                    {t('remove')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {isAdding ? (
        <AddAdvanceTermDialog
          contractId={contractId}
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

interface AdvanceFormValues {
  advanceType: AdvanceType;
  description: string;
  basis: 'amount' | 'percentage';
  amount: string;
  percentage: string;
  recoveryRate: string;
}

function AddAdvanceTermDialog({
  contractId,
  onClose,
}: {
  contractId: string;
  onClose: () => void;
}) {
  const t = useTranslations('platform.contracts.terms.advances');
  const tRetention = useTranslations('platform.contracts.terms.retention');
  const tCommon = useTranslations('common');
  const add = useAddAdvanceTerm(contractId);

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AdvanceFormValues>({
    defaultValues: {
      advanceType: AdvanceType.MOBILIZATION,
      description: '',
      basis: 'amount',
      amount: '',
      percentage: '',
      recoveryRate: '',
    },
  });

  const basis = useWatch({ control, name: 'basis' });

  const onSubmit = (values: AdvanceFormValues) => {
    // Exactly one basis is sent. The DTO would accept both or neither; a term with
    // neither cannot be priced, and one with both is ambiguous.
    add.mutate(
      {
        advanceType: values.advanceType,
        ...(values.description.trim() ? { description: values.description.trim() } : {}),
        ...(values.basis === 'amount'
          ? { amount: toDecimalString(values.amount) }
          : { percentage: percentToFraction(values.percentage) }),
        recoveryRate: percentToFraction(values.recoveryRate),
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

          <FormField htmlFor="advance-type" label={t('type')}>
            <Controller
              control={control}
              name="advanceType"
              render={({ field }) => (
                <Select id="advance-type" value={field.value} onChange={field.onChange}>
                  {ADVANCE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`types.${type}`)}
                    </option>
                  ))}
                </Select>
              )}
            />
          </FormField>

          <FormField htmlFor="advance-description" label={t('description')}>
            <Input id="advance-description" {...register('description')} />
          </FormField>

          <FormField htmlFor="advance-basis" label={t('basis')}>
            <Controller
              control={control}
              name="basis"
              render={({ field }) => (
                <Select id="advance-basis" value={field.value} onChange={field.onChange}>
                  <option value="amount">{t('basisAmount')}</option>
                  <option value="percentage">{t('basisPercentage')}</option>
                </Select>
              )}
            />
          </FormField>

          {basis === 'amount' ? (
            <FormField htmlFor="advance-amount" label={t('amount')} error={errors.amount?.message}>
              <Controller
                name="amount"
                control={control}
                rules={{
                  validate: (v) =>
                    (v.trim() !== '' && Number.isFinite(Number(v))) || t('amountRequired'),
                }}
                render={({ field }) => (
                  <MoneyInput
                    id="advance-amount"
                    dir="ltr"
                    aria-invalid={Boolean(errors.amount)}
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    name={field.name}
                  />
                )}
              />
            </FormField>
          ) : (
            <FormField
              htmlFor="advance-percentage"
              label={t('percentage')}
              error={errors.percentage?.message}
            >
              <Input
                id="advance-percentage"
                inputMode="decimal"
                dir="ltr"
                aria-invalid={Boolean(errors.percentage)}
                {...register('percentage', {
                  validate: (v) => isValidPercent(v) || t('percentageRequired'),
                })}
              />
            </FormField>
          )}

          <FormField
            htmlFor="advance-recovery"
            label={t('recoveryRate')}
            error={errors.recoveryRate?.message}
          >
            <Input
              id="advance-recovery"
              inputMode="decimal"
              dir="ltr"
              aria-describedby="advance-recovery-hint"
              aria-invalid={Boolean(errors.recoveryRate)}
              {...register('recoveryRate', {
                validate: (v) => isValidPercent(v) || tRetention('percentRequired'),
              })}
            />
            <p id="advance-recovery-hint" className="text-xs text-muted-foreground">
              {t('recoveryRateHint')}
            </p>
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
