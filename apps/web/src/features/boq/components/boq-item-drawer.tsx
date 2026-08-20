'use client';

import { useState } from 'react';
import type { BoqTreeNodeResponse } from '@erp/types';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormField,
  Input,
  LtrValue,
  Select,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetTitle,
  Textarea,
} from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

import {
  EMPTY_NODE_FORM,
  NODE_LIMITS,
  previewLineTotal,
  toNodeFormValues,
  type MeasurementMethodValue,
  type NodeFormValues,
  type NodeKind,
  type PricingBasisValue,
} from '../node-form';

export interface DrawerTarget {
  mode: 'add' | 'edit';
  kind: NodeKind;
  /** The section the new node goes under, or null for a root section. */
  parent: BoqTreeNodeResponse | null;
  /** The node being edited. Null when adding. */
  node: BoqTreeNodeResponse | null;
}

/**
 * The item editor.
 *
 * A `Sheet` from `@erp/ui`, which is Radix Dialog. It replaces 318 lines that reimplemented
 * a modal by hand — its own overlay, its own Tab-cycling focus trap, its own
 * `document.body.style.overflow` lock, its own focus restore. All of that is Radix's job,
 * and Radix does it correctly on iOS and with a screen reader.
 *
 * A drawer rather than a centred dialog because editing a BOQ line is a comparison task:
 * the surveyor is checking this rate against the rows above it, which stay visible behind a
 * right-anchored panel. On < sm it goes full screen — `SheetContent` already handles that.
 */
export function BoqItemDrawer({
  target,
  currency,
  readOnly,
  isPending,
  errorMessage,
  onSubmit,
  onClose,
}: {
  target: DrawerTarget | null;
  currency: string;
  readOnly: boolean;
  isPending: boolean;
  errorMessage?: string | undefined;
  onSubmit: (values: NodeFormValues, target: DrawerTarget) => void;
  onClose: () => void;
}) {
  const t = useTranslations('platform.boq.editor');
  const locale = useLocale() as 'en' | 'ar';

  // Seeded once, because the caller gives this component a `key` derived from the target —
  // pointing the drawer at a different row remounts it. An effect that re-seeded on a
  // changing target would be a setState cascade, and would fight the user's own edits on
  // any unrelated re-render.
  const [values, setValues] = useState<NodeFormValues>(() =>
    target?.node ? toNodeFormValues(target.node) : EMPTY_NODE_FORM,
  );
  const [touched, setTouched] = useState(false);

  if (!target) return null;

  const isItem = target.kind === 'item';
  const errors = validate(values, target.kind, t);
  const hasErrors = Object.keys(errors).length > 0;
  const preview = isItem ? previewLineTotal(values) : null;

  const set = <K extends keyof NodeFormValues>(key: K, value: NodeFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const handleSubmit = () => {
    setTouched(true);
    if (hasErrors) return;
    onSubmit(values, target);
  };

  return (
    <Sheet open onOpenChange={(next) => !next && !isPending && onClose()}>
      <SheetContent
        onEscapeKeyDown={(event) => isPending && event.preventDefault()}
        onInteractOutside={(event) => isPending && event.preventDefault()}
      >
        <div className="px-5 pb-4 pt-10">
          <SheetTitle>
            {target.mode === 'add'
              ? isItem
                ? t('addItem')
                : t('addSection')
              : isItem
                ? t('editItem')
                : t('editSection')}
          </SheetTitle>
          <SheetDescription className="mt-1">
            {target.node ? (
              <LtrValue className="font-mono">{target.node.code}</LtrValue>
            ) : target.parent ? (
              t('under', { code: target.parent.code })
            ) : (
              t('atRoot')
            )}
          </SheetDescription>
        </div>

        <div className="border-t border-border" />

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {errorMessage ? <Alert variant="error" messages={[errorMessage]} /> : null}

          {readOnly ? (
            <Alert variant="info" messages={[t('readOnly')]} />
          ) : null}

          <Section title={t('identity')}>
            <FormField
              htmlFor="boq-code"
              label={t('code')}
              error={touched ? errors.code : undefined}
            >
              <Input
                id="boq-code"
                value={values.code}
                maxLength={NODE_LIMITS.codeMax}
                disabled={readOnly || isPending}
                dir="ltr"
                onChange={(event) => set('code', event.target.value)}
              />
            </FormField>

            <FormField
              htmlFor="boq-description"
              label={t('description')}
              error={touched ? errors.description : undefined}
            >
              <Textarea
                id="boq-description"
                rows={2}
                value={values.description}
                maxLength={NODE_LIMITS.descriptionMax}
                disabled={readOnly || isPending}
                onChange={(event) => set('description', event.target.value)}
              />
            </FormField>
          </Section>

          {isItem ? (
            <>
              <Section title={t('measurement')}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    htmlFor="boq-unit"
                    label={t('unit')}
                    error={touched ? errors.unit : undefined}
                  >
                    <Input
                      id="boq-unit"
                      value={values.unit}
                      maxLength={NODE_LIMITS.unitMax}
                      disabled={readOnly || isPending}
                      onChange={(event) => set('unit', event.target.value)}
                    />
                  </FormField>

                  <FormField
                    htmlFor="boq-quantity"
                    label={t('quantity')}
                    error={touched ? errors.quantity : undefined}
                  >
                    <Input
                      id="boq-quantity"
                      inputMode="decimal"
                      dir="ltr"
                      value={values.quantity}
                      disabled={readOnly || isPending}
                      onChange={(event) => set('quantity', event.target.value)}
                    />
                  </FormField>
                </div>

                <FormField htmlFor="boq-measurement-method" label={t('measurementMethod')}>
                  <Select
                    id="boq-measurement-method"
                    value={values.measurementMethod}
                    disabled={readOnly || isPending}
                    onChange={(event) =>
                      set('measurementMethod', event.target.value as MeasurementMethodValue)
                    }
                  >
                    <option value="QUANTITY">{t('method.QUANTITY')}</option>
                    <option value="PERCENTAGE">{t('method.PERCENTAGE')}</option>
                    <option value="MILESTONE">{t('method.MILESTONE')}</option>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t('measurementMethodHint')}</p>
                </FormField>
              </Section>

              <Section title={t('pricing')}>
                <FormField
                  htmlFor="boq-rate"
                  label={t('rate', { currency })}
                  error={touched ? errors.unitRate : undefined}
                >
                  <Input
                    id="boq-rate"
                    inputMode="decimal"
                    dir="ltr"
                    value={values.unitRate}
                    disabled={readOnly || isPending}
                    onChange={(event) => set('unitRate', event.target.value)}
                  />
                </FormField>

                <FormField htmlFor="boq-pricing-basis" label={t('pricingBasis')}>
                  <Select
                    id="boq-pricing-basis"
                    value={values.pricingBasis}
                    disabled={readOnly || isPending}
                    onChange={(event) =>
                      set('pricingBasis', event.target.value as PricingBasisValue)
                    }
                  >
                    <option value="UNIT_RATE">{t('basis.UNIT_RATE')}</option>
                    <option value="LUMP_SUM">{t('basis.LUMP_SUM')}</option>
                  </Select>
                </FormField>

                {/* The currency is stated, not chosen. A BOQ holds one (CONST-BOQ-013), and
                    the server stamps it — an editable field here would imply otherwise. */}
                <div className="flex items-center justify-between rounded-control border border-border bg-surface-subtle px-3 py-2.5">
                  <span className="text-caption text-muted-foreground">{t('amount')}</span>
                  <LtrValue className="text-body-sm font-semibold tabular-nums text-foreground">
                    {preview ? formatMoney(preview, currency, locale) : '—'}
                  </LtrValue>
                </div>
                <p className="text-xs text-muted-foreground">{t('amountHint', { currency })}</p>
              </Section>
            </>
          ) : null}

          {target.node ? (
            <Section title={t('changeSource')}>
              <dl className="space-y-2.5">
                <Fact label={t('source')}>
                  {target.node.sourceType === 'VARIATION'
                    ? (target.node.sourceChangeOrderId ?? t('variation'))
                    : t('baseline')}
                </Fact>
                <Fact label={t('lineage')}>
                  {target.node.originNodeId ? t('carriedForward') : t('newInThisVersion')}
                </Fact>
                <Fact label={t('updated')}>
                  {formatDate(target.node.updatedAt, locale) ?? '—'}
                </Fact>
              </dl>
            </Section>
          ) : null}
        </div>

        <SheetFooter>
          {!readOnly ? (
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? t('saving') : t('save')}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {readOnly ? t('close') : t('cancel')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/70 pb-2.5 last:border-b-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-end text-body-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

/**
 * Mirrors the server's rules so a user is not sent to the API to be refused.
 *
 * Deliberately not the whole set: code uniqueness needs the version, and only the server
 * can answer it authoritatively. That one comes back as a 400 with `details.violations`.
 */
function validate(
  values: NodeFormValues,
  kind: NodeKind,
  t: (key: string, values?: Record<string, string | number>) => string,
): Partial<Record<keyof NodeFormValues, string>> {
  const errors: Partial<Record<keyof NodeFormValues, string>> = {};

  if (!values.code.trim()) errors.code = t('errors.codeRequired');
  else if (values.code.length > NODE_LIMITS.codeMax) errors.code = t('errors.codeTooLong');

  if (!values.description.trim()) errors.description = t('errors.descriptionRequired');

  if (kind === 'item') {
    if (values.unit.length > NODE_LIMITS.unitMax) errors.unit = t('errors.unitTooLong');

    const quantity = values.quantity.trim();
    if (quantity && !new RegExp(`^\\d+(\\.\\d{1,${NODE_LIMITS.quantityDecimals}})?$`).test(quantity)) {
      errors.quantity = t('errors.quantityFormat', { decimals: NODE_LIMITS.quantityDecimals });
    }

    const rate = values.unitRate.trim();
    if (rate && !new RegExp(`^\\d+(\\.\\d{1,${NODE_LIMITS.rateDecimals}})?$`).test(rate)) {
      errors.unitRate = t('errors.rateFormat', { decimals: NODE_LIMITS.rateDecimals });
    }
  }

  return errors;
}
