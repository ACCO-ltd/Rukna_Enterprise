'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input } from '@erp/ui';

import { fractionToPercent, isValidPercent, percentToFraction } from '../contract-terms';
import { useSetRetentionTerms } from '../hooks/use-contract-terms';
import type { ContractRetentionTerms } from '../types';

interface RetentionTermsPanelProps {
  contractId: string;
  terms: ContractRetentionTerms | null;
  canEdit: boolean;
}

interface RetentionFormValues {
  retentionRate: string;
  retentionCap: string;
  retentionSplitOnPc: string;
  retentionReleasedAt: string;
}

export function RetentionTermsPanel({ contractId, terms, canEdit }: RetentionTermsPanelProps) {
  const t = useTranslations('platform.contracts.terms.retention');
  const tCommon = useTranslations('common');
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <RetentionForm
        contractId={contractId}
        terms={terms}
        onDone={() => {
          setIsEditing(false);
        }}
      />
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>
        {canEdit ? (
          <Button
            size="sm"
            variant={terms ? 'outline' : 'default'}
            onClick={() => {
              setIsEditing(true);
            }}
          >
            {terms ? t('edit') : t('set')}
          </Button>
        ) : null}
      </div>

      {terms ? (
        <dl className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-6">
          <Figure label={t('rate')} value={`${fractionToPercent(terms.retentionRate)}%`} />
          <Figure label={t('cap')} value={`${fractionToPercent(terms.retentionCap)}%`} />
          <Figure
            label={t('splitOnPc')}
            value={`${fractionToPercent(terms.retentionSplitOnPC)}%`}
          />
          <Figure
            label={t('releasedAt')}
            value={
              terms.retentionReleasedAt ? (
                terms.retentionReleasedAt.slice(0, 10)
              ) : (
                <span className="text-muted-foreground">{t('notReleased')}</span>
              )
            }
          />
        </dl>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{t('none')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('noneHint')}</p>
        </div>
      )}

      <span className="sr-only">{tCommon('loading')}</span>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function RetentionForm({
  contractId,
  terms,
  onDone,
}: {
  contractId: string;
  terms: ContractRetentionTerms | null;
  onDone: () => void;
}) {
  const t = useTranslations('platform.contracts.terms.retention');
  const tCommon = useTranslations('common');
  const save = useSetRetentionTerms(contractId);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RetentionFormValues>({
    defaultValues: {
      // Stored as Decimal(5,4) fractions, shown to the user as percentages.
      retentionRate: fractionToPercent(terms?.retentionRate),
      retentionCap: fractionToPercent(terms?.retentionCap),
      retentionSplitOnPc: fractionToPercent(terms?.retentionSplitOnPC),
      retentionReleasedAt: terms?.retentionReleasedAt?.slice(0, 10) ?? '',
    },
  });

  const onSubmit = (values: RetentionFormValues) => {
    save.mutate(
      {
        retentionRate: percentToFraction(values.retentionRate),
        retentionCap: percentToFraction(values.retentionCap),
        // Lowercase `Pc` — the request spelling differs from the response's
        // `retentionSplitOnPC`. Echoing the response shape back is a 400. See C10.
        retentionSplitOnPc: percentToFraction(values.retentionSplitOnPc),
        ...(values.retentionReleasedAt ? { retentionReleasedAt: values.retentionReleasedAt } : {}),
      },
      { onSuccess: onDone },
    );
  };

  const percentField = { validate: (v: string) => isValidPercent(v) || t('percentRequired') };

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      className="space-y-5 rounded-lg border border-border bg-surface p-4 sm:p-6"
      noValidate
    >
      <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>

      {save.isError ? <Alert variant="error" messages={[t('failed')]} /> : null}

      <div className="grid gap-5 sm:grid-cols-3">
        <FormField htmlFor="retention-rate" label={t('rate')} error={errors.retentionRate?.message}>
          <Input
            id="retention-rate"
            inputMode="decimal"
            dir="ltr"
            aria-describedby="retention-rate-hint"
            aria-invalid={Boolean(errors.retentionRate)}
            {...register('retentionRate', percentField)}
          />
          <p id="retention-rate-hint" className="text-xs text-muted-foreground">
            {t('rateHint')}
          </p>
        </FormField>

        <FormField htmlFor="retention-cap" label={t('cap')} error={errors.retentionCap?.message}>
          <Input
            id="retention-cap"
            inputMode="decimal"
            dir="ltr"
            aria-describedby="retention-cap-hint"
            aria-invalid={Boolean(errors.retentionCap)}
            {...register('retentionCap', percentField)}
          />
          <p id="retention-cap-hint" className="text-xs text-muted-foreground">
            {t('capHint')}
          </p>
        </FormField>

        <FormField
          htmlFor="retention-split"
          label={t('splitOnPc')}
          error={errors.retentionSplitOnPc?.message}
        >
          <Input
            id="retention-split"
            inputMode="decimal"
            dir="ltr"
            aria-describedby="retention-split-hint"
            aria-invalid={Boolean(errors.retentionSplitOnPc)}
            {...register('retentionSplitOnPc', percentField)}
          />
          <p id="retention-split-hint" className="text-xs text-muted-foreground">
            {t('splitOnPcHint')}
          </p>
        </FormField>
      </div>

      <FormField htmlFor="retention-released" label={t('releasedAt')}>
        <Input
          id="retention-released"
          type="date"
          aria-describedby="retention-released-hint"
          {...register('retentionReleasedAt')}
        />
        <p id="retention-released-hint" className="text-xs text-muted-foreground">
          {t('releasedAtHint')}
        </p>
      </FormField>

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
