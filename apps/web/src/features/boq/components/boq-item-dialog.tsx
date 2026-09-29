'use client';

import { useState } from 'react';
import type { BoqTreeNodeResponse } from '@erp/types';
import { Library } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Button,
  CheckboxField,
  ChoiceCards,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormDialogSection,
  FormField,
  Input,
  LtrValue,
  MoneyInput,
  Notice,
  QuantityInput,
  Select,
  Textarea,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { useUnitsOfMeasure } from '@/features/units-of-measure/hooks/use-units-of-measure';

import type { BoqLibraryItem } from '../api/boq-item-library-api';
import { currencySymbol } from '../currency-symbol';
import {
  EMPTY_NODE_FORM,
  NODE_LIMITS,
  lumpSumOf,
  previewLineTotal,
  toNodeFormValues,
  type MeasurementMethodValue,
  type NodeFormValues,
  type NodeKind,
  type PricingBasisValue,
} from '../node-form';
import { BoqLibraryPicker } from './boq-library-picker';
import { BoqUnitSelect, UnitsUnavailableNotice, isListedUnit } from './boq-unit-select';
import { suggestNodeCode } from '../suggest-node-code';

export interface ItemDialogTarget {
  mode: 'add' | 'edit';
  kind: NodeKind;
  /** The section the new node goes under, or null for a root section. */
  parent: BoqTreeNodeResponse | null;
  /** The node being edited. Null when adding. */
  node: BoqTreeNodeResponse | null;
  /**
   * Codes already in use under `parent`. The dialog proposes the next one from them, so the
   * code field arrives answered rather than blank — see `suggestNodeCode`.
   */
  siblingCodes?: readonly string[];
}

/**
 * What the dialog wants done with the library after the node is saved (ADR-020). Both are
 * assistance and neither blocks the plain add — the workspace runs them best-effort.
 */
export interface LibraryIntent {
  /** The library item this line was prefilled from, if any — its usage rate is recorded. */
  pickedItemId: string | null;
  /** True when the user asked to save this manually-entered item back to the library. */
  saveToLibrary: boolean;
}

type FieldKey = keyof NodeFormValues;

/** Server rule codes (`details.violations`, boq-node.policy.ts) → the field that caused them. */
const FIELD_BY_VIOLATION: Record<string, FieldKey> = {
  DUPLICATE_CODE: 'code',
  NEGATIVE_QUANTITY: 'quantity',
  QUANTITY_SCALE: 'quantity',
  NEGATIVE_RATE: 'unitRate',
  RATE_SCALE: 'unitRate',
};

/**
 * The BOQ section / item editor — a `FormDialog` (ADR-039), size `lg`.
 *
 * It was a side sheet, then a centred dialog, then a sheet again; ADR-039 settles it. The grid
 * edits description, unit, quantity and rate in place, so this dialog is for what the grid does
 * not carry: the pricing basis, the measurement method, the library, the code override, and
 * where the line came from.
 *
 * ─── Pricing basis ───────────────────────────────────────────────────────────────
 *
 * Two cards, because the choice changes which fields follow. "Unit rate" asks for unit,
 * quantity and rate and previews "42 m³ × $160.00 = $6,720.00". "Lump sum" asks for one amount,
 * saved as quantity 1 × rate = amount — the model the absorbed-scope line and the grid's
 * "Lump sum" cell already use (`node-form.ts`, `lumpSumAmount`).
 *
 * ─── Units ───────────────────────────────────────────────────────────────────────
 *
 * From the org's unit registry only (owner decision). A unit already on the line that is not in
 * the registry is kept and flagged, never cleared. An empty or unreadable registry says so and
 * points an administrator at Procurement setup.
 *
 * ─── Money ───────────────────────────────────────────────────────────────────────
 *
 * Without cost visibility the rate, the lump-sum amount and the amount preview are not drawn at
 * all — a money-blind reader is never shown a $0 that stands in for a figure withheld.
 */
export function BoqItemDialog({
  target,
  currency,
  readOnly,
  isPending,
  error,
  libraryEnabled = false,
  canViewCommercials = false,
  canSaveToLibrary = false,
  unitsAdminHref = null,
  onSubmit,
  onClose,
}: {
  target: ItemDialogTarget | null;
  currency: string;
  readOnly: boolean;
  isPending: boolean;
  /** The failed save, if any. Rule violations land on their field; anything else above the form. */
  error?: unknown;
  /** Show the "Add from library" path. Only meaningful when adding a new item. */
  libraryEnabled?: boolean;
  /** Cost visibility: the rate, the lump-sum amount, the amount preview and the picker's last rate. */
  canViewCommercials?: boolean;
  /** Whether the user may save a manually-entered item back to the library. */
  canSaveToLibrary?: boolean;
  /** Where units are managed, for someone allowed to manage them; null otherwise. */
  unitsAdminHref?: string | null;
  onSubmit: (values: NodeFormValues, target: ItemDialogTarget, library: LibraryIntent) => void;
  onClose: () => void;
}) {
  const t = useTranslations('platform.boq.editor');
  const tLib = useTranslations('platform.boq.library');
  const tUnits = useTranslations('platform.boq.units');
  const locale = useLocale() as 'en' | 'ar';
  const unitsQuery = useUnitsOfMeasure();

  // Seeded once, because the caller gives this component a `key` derived from the target —
  // pointing the dialog at a different row remounts it. An effect that re-seeded on a changing
  // target would be a setState cascade, and would fight the user's own edits.
  const [initial] = useState<NodeFormValues>(() => {
    if (target?.node) return toNodeFormValues(target.node);
    if (!target) return EMPTY_NODE_FORM;
    // Proposed, not imposed: the field is editable and the server still owns uniqueness.
    return {
      ...EMPTY_NODE_FORM,
      code: suggestNodeCode(target.kind, target.parent?.code ?? null, target.siblingCodes ?? []),
    };
  });
  const [values, setValues] = useState<NodeFormValues>(initial);
  const [touched, setTouched] = useState(false);
  // D2: the code is server-assigned. It shows as a read-only chip; "Advanced" reveals an editable
  // field to override it.
  const [advancedCode, setAdvancedCode] = useState(false);

  // Library state, only relevant on an item add.
  const [showPicker, setShowPicker] = useState(false);
  const [pickedItemId, setPickedItemId] = useState<string | null>(null);
  const [saveToLibrary, setSaveToLibrary] = useState(false);

  // Fields edited since the last server refusal: their server message is stale and goes.
  // ("Adjust state on prop change" — a new error resets the set without an effect.)
  const [editedSinceError, setEditedSinceError] = useState<ReadonlySet<FieldKey>>(new Set());
  const [seenError, setSeenError] = useState<unknown>(error);
  if (error !== seenError) {
    setSeenError(error);
    setEditedSinceError(new Set());
  }

  if (!target) return null;

  const isItem = target.kind === 'item';
  const isAdd = target.mode === 'add';
  const lumpSum = values.pricingBasis === 'LUMP_SUM';
  const locked = readOnly || isPending;
  // The library only assists adding a NEW item, and only for someone who can manage the BOQ.
  const showLibrary = libraryEnabled && isItem && isAdd && !readOnly;

  const clientErrors = validate(values, target.kind, t);
  const server = serverErrors(error, lumpSum);
  const fieldError = (key: FieldKey): string | undefined =>
    (touched ? clientErrors[key] : undefined) ??
    (editedSinceError.has(key) ? undefined : server.fields[key]);
  // A code refusal with the override field closed has nowhere to sit but the form-level notice.
  const formMessages = [
    ...server.form,
    ...(!advancedCode && server.fields.code && !editedSinceError.has('code') ? [server.fields.code] : []),
  ];

  const dirty =
    (Object.keys(values) as FieldKey[]).some((key) => values[key] !== initial[key]) ||
    saveToLibrary ||
    pickedItemId !== null;

  const set = <K extends FieldKey>(key: K, value: NodeFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    if (!editedSinceError.has(key)) setEditedSinceError((current) => new Set(current).add(key));
  };

  const choosePricingBasis = (basis: PricingBasisValue) => {
    setValues((current) => ({
      ...current,
      pricingBasis: basis,
      // Arriving at "Lump sum" with a measured line already priced: start from what it totals
      // to, rather than an empty box. The measured quantity and rate are kept for a switch back.
      lumpSumAmount:
        basis === 'LUMP_SUM' && !current.lumpSumAmount
          ? (previewLineTotal({ ...current, pricingBasis: 'UNIT_RATE' }) ?? '')
          : current.lumpSumAmount,
    }));
  };

  /** Prefills the form from a library item. Assistance — every field stays editable. */
  const applyLibraryItem = (item: BoqLibraryItem) => {
    setValues((current) => ({
      ...current,
      description: item.description,
      unit: item.defaultUnit ?? current.unit,
      measurementMethod: item.measurementMethod,
      pricingBasis: item.pricingBasis,
      // Last-used rate is a starting point, never authoritative (CONST-BOQ-021). For a lump sum
      // the rate IS the amount (quantity 1).
      unitRate: item.pricingBasis === 'UNIT_RATE' ? (item.lastUsedRate ?? current.unitRate) : current.unitRate,
      lumpSumAmount:
        item.pricingBasis === 'LUMP_SUM'
          ? lumpSumOf('1', item.lastUsedRate) || current.lumpSumAmount
          : current.lumpSumAmount,
    }));
    setPickedItemId(item.id);
    // Once prefilled from the library, re-saving it would just duplicate what is already there.
    setSaveToLibrary(false);
    setShowPicker(false);
  };

  const handleSubmit = () => {
    setTouched(true);
    if (Object.keys(clientErrors).length > 0) return;
    // On an add that did not override the code, send it empty so the server auto-numbers (D2).
    const submitted = isAdd && !advancedCode ? { ...values, code: '' } : values;
    onSubmit(submitted, target, {
      pickedItemId: showLibrary ? pickedItemId : null,
      saveToLibrary: showLibrary && saveToLibrary,
    });
  };

  const title = dialogTitle(target, t);
  const subtitle = isItem
    ? canViewCommercials
      ? t('subtitleItem')
      : t('subtitleItemNoPricing')
    : t('subtitleSection');

  const units = unitsQuery.data ?? [];
  const unitsUnavailable = unitsQuery.isError || (unitsQuery.isSuccess && units.length === 0);
  const legacyUnit = values.unit !== '' && !isListedUnit(units, values.unit) && unitsQuery.isSuccess;

  const preview = isItem && canViewCommercials && !lumpSum ? previewLineTotal(values) : null;
  const quantityText = values.quantity.trim()
    ? formatNumber(values.quantity, locale)
    : null;

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      subtitle={subtitle}
      size="lg"
      dirty={dirty && !readOnly}
      busy={isPending}
      onSubmit={readOnly ? undefined : handleSubmit}
      closeLabel={t('close')}
      discardLabels={{
        title: t('discard.title'),
        description: t('discard.description'),
        confirm: t('discard.confirm'),
        cancel: t('discard.cancel'),
      }}
    >
      <FormDialogBody>
        {formMessages.length > 0 ? (
          <Notice tone="danger" title={t('saveFailed')}>
            {formMessages.length === 1 ? (
              formMessages[0]
            ) : (
              <ul className="list-disc space-y-0.5 ps-4">
                {formMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </Notice>
        ) : null}

        {readOnly ? <Notice tone="info">{t('readOnly')}</Notice> : null}

        {/* Library fast-entry: an ADDITIONAL path, disclosed by choice, that never changes how a
            plain manual add works. */}
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

            {pickedItemId ? <Notice tone="info">{tLib('prefilledFrom')}</Notice> : null}
          </section>
        ) : null}

        <div className="space-y-4">
          {/* D2: the code reads as a chip; "Advanced" reveals an override field. */}
          {advancedCode ? (
            <FormField
              htmlFor="boq-code"
              label={isItem ? t('code') : t('sectionCode')}
              hint={isAdd ? t('codeOverrideHint') : t('codeRenumberHint')}
              error={fieldError('code')}
            >
              <div className="flex items-center gap-2">
                <Input
                  id="boq-code"
                  value={values.code}
                  placeholder={isItem ? t('itemCodePlaceholder') : t('codePlaceholder')}
                  maxLength={NODE_LIMITS.codeMax}
                  disabled={locked}
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
              <div className="flex items-center justify-between gap-2 rounded-control border border-border bg-surface-subtle px-3 py-1.5">
                <span className="flex items-center gap-2">
                  <LtrValue className="font-mono text-body-sm font-semibold text-foreground">
                    {values.code || '—'}
                  </LtrValue>
                  {isAdd ? <span className="text-caption text-muted-foreground">{t('codeAuto')}</span> : null}
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
            required
            error={fieldError('description')}
          >
            <Textarea
              id="boq-description"
              data-autofocus={locked ? undefined : ''}
              rows={3}
              placeholder={isItem ? t('descriptionPlaceholderItem') : t('descriptionPlaceholderSection')}
              value={values.description}
              maxLength={NODE_LIMITS.descriptionMax}
              disabled={locked}
              onChange={(event) => set('description', event.target.value)}
            />
          </FormField>

          {isItem ? (
            <>
              <ChoiceCards<PricingBasisValue>
                label={t('pricingBasis')}
                value={values.pricingBasis}
                onChange={choosePricingBasis}
                disabled={locked}
                columns={2}
                options={[
                  { value: 'UNIT_RATE', label: t('basis.UNIT_RATE'), hint: t('basisHint.UNIT_RATE') },
                  { value: 'LUMP_SUM', label: t('basis.LUMP_SUM'), hint: t('basisHint.LUMP_SUM') },
                ]}
              />

              {!lumpSum ? (
                <>
                  <div className={canViewCommercials ? 'grid gap-4 sm:grid-cols-3' : 'grid gap-4 sm:grid-cols-2'}>
                    <FormField
                      htmlFor="boq-unit"
                      label={t('unit')}
                      error={fieldError('unit')}
                      warning={legacyUnit ? tUnits('legacyNote') : undefined}
                    >
                      {unitsQuery.isPending ? (
                        <div
                          role="status"
                          className="flex h-control items-center rounded-control border border-border bg-surface-subtle px-3 text-body-sm text-muted-foreground"
                        >
                          {tUnits('loading')}
                        </div>
                      ) : (
                        <BoqUnitSelect
                          id="boq-unit"
                          value={values.unit}
                          units={units}
                          disabled={locked}
                          onChange={(symbol) => set('unit', symbol)}
                        />
                      )}
                    </FormField>

                    <FormField
                      htmlFor="boq-quantity"
                      label={t('quantity')}
                      error={fieldError('quantity')}
                    >
                      <QuantityInput
                        id="boq-quantity"
                        dir="ltr"
                        unit={values.unit || undefined}
                        maxFractionDigits={NODE_LIMITS.quantityDecimals}
                        value={values.quantity}
                        disabled={locked}
                        onValueChange={(next) => set('quantity', next)}
                      />
                    </FormField>

                    {canViewCommercials ? (
                      <FormField
                        htmlFor="boq-rate"
                        label={t('rate', { currency })}
                        error={fieldError('unitRate')}
                      >
                        <MoneyInput
                          id="boq-rate"
                          dir="ltr"
                          currencyMark={currencySymbol(currency)}
                          value={values.unitRate}
                          disabled={locked}
                          onValueChange={(next) => set('unitRate', next)}
                        />
                      </FormField>
                    ) : null}
                  </div>

                  {unitsUnavailable ? (
                    <UnitsUnavailableNotice reason={unitsQuery.isError ? 'error' : 'empty'} adminHref={unitsAdminHref} />
                  ) : null}

                  {preview && quantityText ? (
                    <p
                      className="rounded-control border border-border bg-surface-subtle px-3 py-2.5 text-body-sm tabular-nums text-muted-foreground"
                      aria-live="polite"
                    >
                      <LtrValue>
                        {`${quantityText}${values.unit ? ` ${values.unit}` : ''} × ${formatMoney(values.unitRate, currency, locale) ?? ''} = `}
                        <span className="font-semibold text-foreground">{formatMoney(preview, currency, locale)}</span>
                      </LtrValue>
                    </p>
                  ) : null}
                </>
              ) : canViewCommercials ? (
                <FormField
                  htmlFor="boq-lump-sum"
                  label={t('lumpSumAmount')}
                  hint={t('lumpSumHint', { currency })}
                  error={fieldError('lumpSumAmount')}
                >
                  <MoneyInput
                    id="boq-lump-sum"
                    dir="ltr"
                    currencyMark={currencySymbol(currency)}
                    value={values.lumpSumAmount}
                    disabled={locked}
                    onValueChange={(next) => set('lumpSumAmount', next)}
                  />
                </FormField>
              ) : null}

              <FormField
                htmlFor="boq-measurement-method"
                label={t('measurementMethod')}
                hint={t('measurementMethodHint')}
              >
                <Select
                  id="boq-measurement-method"
                  value={values.measurementMethod}
                  disabled={locked}
                  onChange={(value) => set('measurementMethod', value as MeasurementMethodValue)}
                >
                  <option value="QUANTITY">{t('method.QUANTITY')}</option>
                  <option value="PERCENTAGE">{t('method.PERCENTAGE')}</option>
                  <option value="MILESTONE">{t('method.MILESTONE')}</option>
                </Select>
              </FormField>

              {/* Save-to-library: offered only on a manual add (an item prefilled from the library
                  is not re-saved) and only when the user may write to the library. */}
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
        </div>

        {target.node ? (
          <FormDialogSection title={t('changeSource')}>
            <dl className="space-y-2.5">
              <Fact label={t('source')}>
                {target.node.sourceType === 'VARIATION'
                  ? (target.node.sourceChangeOrderId ?? t('variation'))
                  : t('baseline')}
              </Fact>
              <Fact label={t('lineage')}>
                {target.node.originNodeId ? t('carriedForward') : t('newInThisVersion')}
              </Fact>
              <Fact label={t('updated')}>{formatDate(target.node.updatedAt, locale) ?? '—'}</Fact>
            </dl>
          </FormDialogSection>
        ) : null}
      </FormDialogBody>

      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={isPending}>
            {readOnly ? t('close') : t('cancel')}
          </Button>
        </FormDialogClose>
        {!readOnly ? (
          <Button type="submit" disabled={isPending}>
            {isPending
              ? t('saving')
              : isAdd
                ? isItem
                  ? t('addItemAction')
                  : t('addSectionAction')
                : isItem
                  ? t('saveItem')
                  : t('saveSection')}
          </Button>
        ) : null}
      </FormDialogFooter>
    </FormDialog>
  );
}

/** "Item 2.1", "Section 2", "New item in 2 · Superstructure", "New section". */
function dialogTitle(
  target: ItemDialogTarget,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  const isItem = target.kind === 'item';
  if (target.node) {
    return t(isItem ? 'titleItem' : 'titleSection', { code: target.node.code });
  }
  if (target.parent) {
    return t(isItem ? 'titleNewItemIn' : 'titleNewSectionIn', {
      code: target.parent.code,
      name: target.parent.description,
    });
  }
  return t(isItem ? 'titleNewItem' : 'titleNewSection');
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-2.5 last:border-b-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-end text-body-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

/**
 * A refused save, split into what belongs on a field and what belongs above the form.
 *
 * The node rules come back as `details.violations` (`boq-node.policy.ts`); the ones that name a
 * field land on it. A rate rule on a lump sum lands on the lump-sum amount, which is the rate
 * there. Everything else — class-validator messages, a network failure — goes to the notice.
 */
function serverErrors(
  error: unknown,
  lumpSum: boolean,
): { fields: Partial<Record<FieldKey, string>>; form: string[] } {
  if (!error) return { fields: {}, form: [] };
  if (!(error instanceof ApiError)) return { fields: {}, form: [error instanceof Error ? error.message : String(error)] };

  const fields: Partial<Record<FieldKey, string>> = {};
  const form: string[] = [];
  const violations = error.details?.['violations'];
  if (Array.isArray(violations) && violations.length > 0) {
    for (const violation of violations as { code?: string; message?: string }[]) {
      const message = violation.message ?? error.message;
      let field = violation.code ? FIELD_BY_VIOLATION[violation.code] : undefined;
      if (lumpSum && (field === 'unitRate' || field === 'quantity')) field = 'lumpSumAmount';
      if (field && !fields[field]) fields[field] = message;
      else if (!field) form.push(message);
    }
    return { fields, form };
  }
  return { fields, form: error.messages.length > 0 ? error.messages : [error.message] };
}

/**
 * Mirrors the server's rules so a user is not sent to the API to be refused.
 *
 * Deliberately not the whole set: code uniqueness needs the version, and only the server can
 * answer it authoritatively. That one comes back as a 400 with `details.violations`.
 */
function validate(
  values: NodeFormValues,
  kind: NodeKind,
  t: (key: string, values?: Record<string, string | number>) => string,
): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};

  if (!values.code.trim()) errors.code = t('errors.codeRequired');
  else if (values.code.length > NODE_LIMITS.codeMax) errors.code = t('errors.codeTooLong');
  if (!values.description.trim()) errors.description = t('errors.descriptionRequired');

  if (kind === 'item') {
    if (values.unit.length > NODE_LIMITS.unitMax) errors.unit = t('errors.unitTooLong');

    const decimals = (text: string, places: number) =>
      new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(text.trim());

    if (values.pricingBasis === 'LUMP_SUM') {
      const amount = values.lumpSumAmount.trim();
      if (amount && !decimals(amount, NODE_LIMITS.rateDecimals)) {
        errors.lumpSumAmount = t('errors.rateFormat', { decimals: NODE_LIMITS.rateDecimals });
      }
    } else {
      const quantity = values.quantity.trim();
      if (quantity && !decimals(quantity, NODE_LIMITS.quantityDecimals)) {
        errors.quantity = t('errors.quantityFormat', { decimals: NODE_LIMITS.quantityDecimals });
      }
      const rate = values.unitRate.trim();
      if (rate && !decimals(rate, NODE_LIMITS.rateDecimals)) {
        errors.unitRate = t('errors.rateFormat', { decimals: NODE_LIMITS.rateDecimals });
      }
    }
  }

  return errors;
}
