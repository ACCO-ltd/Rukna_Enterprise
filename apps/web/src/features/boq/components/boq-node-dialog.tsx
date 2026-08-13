'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, FormField, Input } from '@erp/ui';

import { formatMoney } from '@/lib/format';

import {
  EMPTY_NODE_FORM,
  NODE_LIMITS,
  previewLineTotal,
  toNodeFormValues,
  type NodeFormValues,
  type NodeKind,
} from '../node-form';
import type { BoqTreeNode } from '../types';

interface BoqNodeDialogProps {
  kind: NodeKind;
  /** Present when editing; absent when adding. */
  node?: BoqTreeNode | undefined;
  /** Written onto priced rows. Null when the project has no contract currency. */
  projectCurrency: string | null;
  isPending: boolean;
  errorMessage?: string | undefined;
  onSubmit: (values: NodeFormValues) => void;
  onDismiss: () => void;
}

export function BoqNodeDialog({
  kind,
  node,
  projectCurrency,
  isPending,
  errorMessage,
  onSubmit,
  onDismiss,
}: BoqNodeDialogProps) {
  const t = useTranslations('platform.boq.nodes');
  const locale = useLocale() as 'en' | 'ar';
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const [values, setValues] = useState<NodeFormValues>(
    node ? toNodeFormValues(node) : EMPTY_NODE_FORM,
  );
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPending) onDismiss();
      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, textarea, select, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [isPending, onDismiss]);

  const set = (field: keyof NodeFormValues) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const errors = validate(values, kind, t);
  const hasErrors = Object.values(errors).some(Boolean);
  const isItem = kind === 'item';

  const title = t(
    node
      ? isItem
        ? 'editItemTitle'
        : 'editSectionTitle'
      : isItem
        ? 'addItemTitle'
        : 'addSectionTitle',
  );

  const preview = isItem ? previewLineTotal(values) : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (hasErrors) return;
    onSubmit(values);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="fixed inset-0 bg-overlay" aria-hidden="true" onClick={onDismiss} />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-xl sm:p-6"
      >
        <h2 id={titleId} className="text-lg font-semibold text-foreground">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(isItem ? 'itemHint' : 'sectionHint')}
        </p>

        {errorMessage ? (
          <div className="mt-4">
            <Alert variant="error" messages={[errorMessage]} />
          </div>
        ) : null}

        <form className="mt-4 space-y-4" onSubmit={submit} noValidate>
          <FormField htmlFor="node-code" label={t('codeLabel')} error={touched ? errors.code : undefined}>
            <Input
              id="node-code"
              ref={firstFieldRef}
              value={values.code}
              placeholder={t('codePlaceholder')}
              maxLength={NODE_LIMITS.codeMax}
              onChange={(e) => {
                set('code')(e.target.value);
              }}
              aria-invalid={Boolean(touched && errors.code)}
            />
          </FormField>

          <FormField
            htmlFor="node-description"
            label={t('descriptionLabel')}
            error={touched ? errors.description : undefined}
          >
            <Input
              id="node-description"
              value={values.description}
              onChange={(e) => {
                set('description')(e.target.value);
              }}
              aria-invalid={Boolean(touched && errors.description)}
            />
          </FormField>

          <FormField htmlFor="node-description-ar" label={t('descriptionArLabel')} error={touched ? errors.descriptionAr : undefined}>
            {/* Always RTL: this field holds Arabic whatever the interface language. */}
            <Input
              id="node-description-ar"
              dir="rtl"
              value={values.descriptionAr}
              onChange={(e) => {
                set('descriptionAr')(e.target.value);
              }}
            />
          </FormField>

          {isItem ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField htmlFor="node-unit" label={t('unitLabel')} error={touched ? errors.unit : undefined}>
                  <Input
                    id="node-unit"
                    value={values.unit}
                    placeholder={t('unitPlaceholder')}
                    maxLength={NODE_LIMITS.unitMax}
                    onChange={(e) => {
                      set('unit')(e.target.value);
                    }}
                  />
                </FormField>

                <FormField htmlFor="node-quantity" label={t('quantityLabel')} error={touched ? errors.quantity : undefined}>
                  <Input
                    id="node-quantity"
                    inputMode="decimal"
                    dir="ltr"
                    className="text-start"
                    value={values.quantity}
                    onChange={(e) => {
                      set('quantity')(e.target.value);
                    }}
                    aria-invalid={Boolean(touched && errors.quantity)}
                  />
                </FormField>

                <FormField htmlFor="node-rate" label={t('rateLabel')} error={touched ? errors.unitRate : undefined}>
                  <Input
                    id="node-rate"
                    inputMode="decimal"
                    dir="ltr"
                    className="text-start"
                    value={values.unitRate}
                    onChange={(e) => {
                      set('unitRate')(e.target.value);
                    }}
                    aria-invalid={Boolean(touched && errors.unitRate)}
                  />
                </FormField>
              </div>

              {/*
                Currency is shown, not chosen. It comes from the project's contract
                currency so a BOQ cannot end up denominated in several currencies — see
                node-form.ts and D1.
              */}
              <div className="rounded-md border border-border bg-surface-subtle px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('currencyLabel')}
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {projectCurrency ?? '—'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {projectCurrency ? t('currencyLocked') : t('currencyMissing')}
                </p>

                {preview !== null ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t('previewTotal')}
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-foreground">
                        {formatMoney(preview, projectCurrency, locale)}
                      </span>
                    </div>
                    {/* Explicitly a preview — the server recomputes it on save and owns
                        the stored figure. */}
                    <p className="mt-1 text-xs text-muted-foreground">{t('previewNote')}</p>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row-reverse sm:justify-start">
            <Button type="submit" disabled={isPending}>
              {isPending ? t('saving') : t('save')}
            </Button>
            <Button type="button" variant="outline" onClick={onDismiss} disabled={isPending}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

type FieldErrors = Partial<Record<keyof NodeFormValues, string>>;

/** Mirrors CreateNodeDto so the user is not sent to the server to be refused. */
function validate(
  values: NodeFormValues,
  kind: NodeKind,
  t: (key: string) => string,
): FieldErrors {
  const errors: FieldErrors = {};

  const code = values.code.trim();
  if (!code) errors.code = t('codeRequired');
  else if (code.length > NODE_LIMITS.codeMax) errors.code = t('codeTooLong');

  const description = values.description.trim();
  if (!description) errors.description = t('descriptionRequired');
  else if (description.length > NODE_LIMITS.descriptionMax) {
    errors.description = t('descriptionTooLong');
  }

  if (values.descriptionAr.trim().length > NODE_LIMITS.descriptionMax) {
    errors.descriptionAr = t('descriptionTooLong');
  }

  if (kind !== 'item') return errors;

  if (values.unit.trim().length > NODE_LIMITS.unitMax) errors.unit = t('unitTooLong');

  const quantity = values.quantity.trim();
  if (quantity) {
    if (!Number.isFinite(Number(quantity))) errors.quantity = t('quantityInvalid');
    else if (Number(quantity) < 0) errors.quantity = t('quantityNegative');
    else if (!/^\d*(\.\d{1,3})?$/.test(quantity)) errors.quantity = t('quantityDecimals');
  }

  const rate = values.unitRate.trim();
  if (rate) {
    if (!Number.isFinite(Number(rate))) errors.unitRate = t('rateInvalid');
    else if (Number(rate) < 0) errors.unitRate = t('rateNegative');
    else if (!/^\d*(\.\d{1,2})?$/.test(rate)) errors.unitRate = t('rateDecimals');
  }

  return errors;
}
