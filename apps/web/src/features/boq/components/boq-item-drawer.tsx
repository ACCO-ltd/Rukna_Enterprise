'use client';

import { useState } from 'react';
import type { BoqTreeNodeResponse } from '@erp/types';
import { Library } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  CheckboxField,
  FormField,
  Input,
  LtrValue,
  MoneyInput,
  Select,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Textarea,
} from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

import type { BoqLibraryItem } from '../api/boq-item-library-api';
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
import { BoqLibraryPicker } from './boq-library-picker';
import { suggestNodeCode } from '../suggest-node-code';

export interface DrawerTarget {
  mode: 'add' | 'edit';
  kind: NodeKind;
  /** The section the new node goes under, or null for a root section. */
  parent: BoqTreeNodeResponse | null;
  /** The node being edited. Null when adding. */
  node: BoqTreeNodeResponse | null;
  /**
   * Codes already in use under `parent`. The drawer proposes the next one from them, so the
   * code field arrives answered rather than blank — see `suggestNodeCode`.
   */
  siblingCodes?: readonly string[];
}

/**
 * What the drawer wants done with the library after the node is saved (ADR-020). Both are
 * assistance and neither blocks the plain add — the workspace runs them best-effort.
 */
export interface LibraryIntent {
  /** The library item this line was prefilled from, if any — its usage rate is recorded. */
  pickedItemId: string | null;
  /** True when the user asked to save this manually-entered item back to the library. */
  saveToLibrary: boolean;
}

/**
 * The item editor.
 *
 * A `Dialog` from `@erp/ui`, which is Radix Dialog. It replaces 318 lines that reimplemented
 * a modal by hand — its own overlay, its own Tab-cycling focus trap, its own
 * `document.body.style.overflow` lock, its own focus restore. All of that is Radix's job,
 * and Radix does it correctly on iOS and with a screen reader.
 *
 * It was a right-anchored drawer, on the argument that editing a BOQ line is a comparison
 * task — the surveyor checks this rate against the rows above it, and a side panel leaves
 * them visible. The argument is real but the panel did not deliver it: at 420px it covered
 * the right third of the table, which is where the rate column sits, and it gave the form
 * itself less width than its seven fields wanted. A wider centred dialog trades a partial
 * view of the rows for a form you can actually read; if the comparison turns out to matter
 * more than that in use, the honest fix is a split view, not a narrow panel.
 */
export function BoqItemDrawer({
  target,
  currency,
  readOnly,
  isPending,
  errorMessage,
  libraryEnabled = false,
  canViewCommercials = false,
  canSaveToLibrary = false,
  onSubmit,
  onClose,
}: {
  target: DrawerTarget | null;
  currency: string;
  readOnly: boolean;
  isPending: boolean;
  errorMessage?: string | undefined;
  /** Show the "Add from library" path. Only meaningful when adding a new item. */
  libraryEnabled?: boolean;
  /** Gates whether the assistive last-used rate is shown in the picker. */
  canViewCommercials?: boolean;
  /** Whether the user may save a manually-entered item back to the library. */
  canSaveToLibrary?: boolean;
  onSubmit: (values: NodeFormValues, target: DrawerTarget, library: LibraryIntent) => void;
  onClose: () => void;
}) {
  const t = useTranslations('platform.boq.editor');
  const tLib = useTranslations('platform.boq.library');
  const locale = useLocale() as 'en' | 'ar';

  // Seeded once, because the caller gives this component a `key` derived from the target —
  // pointing the drawer at a different row remounts it. An effect that re-seeded on a
  // changing target would be a setState cascade, and would fight the user's own edits on
  // any unrelated re-render.
  const [values, setValues] = useState<NodeFormValues>(() => {
    if (target?.node) return toNodeFormValues(target.node);
    if (!target) return EMPTY_NODE_FORM;
    // Proposed, not imposed: the field is editable and the server still owns uniqueness. What
    // this removes is having to know the numbering convention before you can type anything.
    return {
      ...EMPTY_NODE_FORM,
      code: suggestNodeCode(target.kind, target.parent?.code ?? null, target.siblingCodes ?? []),
    };
  });
  const [touched, setTouched] = useState(false);
  // D2: the code is server-assigned. It shows as a read-only chip; "Advanced" reveals an editable
  // field to override it. On edit, the code starts revealed only if the user chooses to renumber.
  const [advancedCode, setAdvancedCode] = useState(false);

  // Library state, only relevant on an item add. `pickedItemId` records which library item
  // (if any) prefilled the form, so its usage rate can be recorded after the node saves.
  // `saveToLibrary` is the reverse path — persist a manual entry for reuse. `showPicker`
  // toggles the search list open; it stays a disclosure so a plain manual add is unchanged.
  const [showPicker, setShowPicker] = useState(false);
  const [pickedItemId, setPickedItemId] = useState<string | null>(null);
  const [saveToLibrary, setSaveToLibrary] = useState(false);

  if (!target) return null;

  const isItem = target.kind === 'item';
  const isAdd = target.mode === 'add';
  // The library only assists adding a NEW item, and only for someone who can manage the BOQ.
  const showLibrary = libraryEnabled && isItem && isAdd && !readOnly;
  const errors = validate(values, target.kind, t);
  const hasErrors = Object.keys(errors).length > 0;
  const preview = isItem ? previewLineTotal(values) : null;

  const set = <K extends keyof NodeFormValues>(key: K, value: NodeFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  /** Prefills the form from a library item. Assistance — every field stays editable. */
  const applyLibraryItem = (item: BoqLibraryItem) => {
    setValues((current) => ({
      ...current,
      description: item.description,
      unit: item.defaultUnit ?? current.unit,
      measurementMethod: item.measurementMethod,
      pricingBasis: item.pricingBasis,
      // Last-used rate is a starting point, never authoritative (CONST-BOQ-021).
      unitRate: item.lastUsedRate ?? current.unitRate,
    }));
    setPickedItemId(item.id);
    // Once a manual entry has been prefilled from the library, re-saving it would just
    // duplicate what is already there.
    setSaveToLibrary(false);
    setShowPicker(false);
  };

  const handleSubmit = () => {
    setTouched(true);
    if (hasErrors) return;
    // On an add that did not override the code, send it empty so the server auto-numbers (D2).
    const submitted = isAdd && !advancedCode ? { ...values, code: '' } : values;
    onSubmit(submitted, target, {
      pickedItemId: showLibrary ? pickedItemId : null,
      saveToLibrary: showLibrary && saveToLibrary,
    });
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !isPending && onClose()}>
      <DialogContent
        className="sm:max-w-2xl"
        onEscapeKeyDown={(event) => isPending && event.preventDefault()}
        onInteractOutside={(event) => isPending && event.preventDefault()}
      >
        <div className="px-5 pb-4 pt-10">
          <DialogTitle>
            {target.mode === 'add'
              ? isItem
                ? t('addItem')
                : t('addSection')
              : isItem
                ? t('editItem')
                : t('editSection')}
          </DialogTitle>
          <DialogDescription className="mt-1">
            {target.node ? (
              <LtrValue className="font-mono">{target.node.code}</LtrValue>
            ) : target.parent ? (
              t('under', { code: target.parent.code })
            ) : (
              t('atRoot')
            )}
          </DialogDescription>
        </div>

        <div className="border-t border-border" />

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {errorMessage ? <Alert variant="error" messages={[errorMessage]} /> : null}

          {readOnly ? (
            <Alert variant="info" messages={[t('readOnly')]} />
          ) : null}

          {/* Library fast-entry: an ADDITIONAL path, disclosed by choice, that never changes
              how a plain manual add works. A first-time builder sees a quiet toggle; a QS
              assembling from known items opens the picker and prefills a line in one click. */}
          {showLibrary ? (
            <section className="space-y-3 rounded-panel border border-border bg-surface-subtle p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-body-sm font-semibold text-foreground">
                  <Library size={16} className="text-muted-foreground" aria-hidden="true" />
                  {tLib('sectionTitle')}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setShowPicker((current) => !current)}
                >
                  {showPicker ? tLib('toggleClose') : tLib('toggleOpen')}
                </Button>
              </div>

              {showPicker ? (
                <BoqLibraryPicker
                  currency={currency}
                  canViewCommercials={canViewCommercials}
                  onPick={applyLibraryItem}
                />
              ) : null}

              {pickedItemId ? (
                <Alert variant="info" messages={[tLib('prefilledFrom')]} />
              ) : null}
            </section>
          ) : null}

          <Section title={t('identity')}>
            {/* D2: the code is server-assigned. It reads as a chip; "Advanced" reveals an
                override field — the user does not fill a blank box for the one value that must be
                unique and is quoted by every downstream document. */}
            {advancedCode ? (
              <FormField
                htmlFor="boq-code"
                label={isItem ? t('code') : t('sectionCode')}
                hint={isAdd ? t('codeOverrideHint') : t('codeRenumberHint')}
                error={touched ? errors.code : undefined}
              >
                <div className="flex items-center gap-2">
                  <Input
                    id="boq-code"
                    value={values.code}
                    placeholder={isItem ? t('itemCodePlaceholder') : t('codePlaceholder')}
                    maxLength={NODE_LIMITS.codeMax}
                    disabled={readOnly || isPending}
                    dir="ltr"
                    className="font-mono"
                    onChange={(event) => set('code', event.target.value)}
                  />
                  {isAdd ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => {
                        set(
                          'code',
                          suggestNodeCode(target.kind, target.parent?.code ?? null, target.siblingCodes ?? []),
                        );
                        setAdvancedCode(false);
                      }}
                    >
                      {t('codeUseAuto')}
                    </Button>
                  ) : null}
                </div>
              </FormField>
            ) : (
              <div className="space-y-1.5">
                <span className="text-body-sm font-medium text-foreground">
                  {isItem ? t('code') : t('sectionCode')}
                </span>
                <div className="flex items-center justify-between gap-2 rounded-control border border-border bg-surface-subtle px-3 py-2">
                  <span className="flex items-center gap-2">
                    <LtrValue className="font-mono text-body-sm font-semibold text-foreground">
                      {values.code || '—'}
                    </LtrValue>
                    {isAdd ? (
                      <span className="text-caption text-muted-foreground">{t('codeAuto')}</span>
                    ) : null}
                  </span>
                  {!readOnly ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => setAdvancedCode(true)}
                    >
                      {isAdd ? t('codeSetCustom') : t('codeChange')}
                    </Button>
                  ) : null}
                </div>
              </div>
            )}

            <FormField
              htmlFor="boq-description"
              label={t('description')}
              error={touched ? errors.description : undefined}
            >
              <Textarea
                id="boq-description"
                rows={2}
                placeholder={
                  isItem ? t('descriptionPlaceholderItem') : t('descriptionPlaceholderSection')
                }
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
                    onChange={(value) =>
                      set('measurementMethod', value as MeasurementMethodValue)
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
                  <MoneyInput
                    id="boq-rate"
                    dir="ltr"
                    value={values.unitRate}
                    disabled={readOnly || isPending}
                    onValueChange={(v) => set('unitRate', v)}
                  />
                </FormField>

                <FormField htmlFor="boq-pricing-basis" label={t('pricingBasis')}>
                  <Select
                    id="boq-pricing-basis"
                    value={values.pricingBasis}
                    disabled={readOnly || isPending}
                    onChange={(value) =>
                      set('pricingBasis', value as PricingBasisValue)
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

              {/* Save-to-library: the reverse of the fast-entry path. Offered only on a manual
                  add (an item already prefilled from the library is not re-saved) and only when
                  the user may write to the library. Ticking it grows the reusable catalogue. */}
              {showLibrary && canSaveToLibrary && !pickedItemId ? (
                <CheckboxField
                  id="boq-save-to-library"
                  checked={saveToLibrary}
                  disabled={isPending}
                  onChange={(event) => setSaveToLibrary(event.target.checked)}
                  label={tLib('saveToLibrary')}
                  description={tLib('saveToLibraryHint')}
                />
              ) : null}
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

        <DialogFooter>
          {!readOnly ? (
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending
                ? t('saving')
                : isAdd
                  ? isItem
                    ? t('addItemAction')
                    : t('addSectionAction')
                  : t('save')}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {readOnly ? t('close') : t('cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
