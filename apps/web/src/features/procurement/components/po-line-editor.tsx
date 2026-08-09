'use client';

/**
 * Purchase order line editor (§12.6, step 2).
 *
 * The MR line editor plus a price, an extended amount, and allocations back to approved
 * material request lines.
 *
 * `extendedAmount` is computed here in integer minor units and shown live. Quantity is
 * 3dp and price is 2dp, so their product is 5dp and has to come back to 2 — that scale
 * change is the one piece of arithmetic on this screen that is easy to get silently
 * wrong, and it lives in `extendedAmountMinor` with its own tests rather than inline.
 *
 * The value shown is a **preview**. The server recomputes it, and its answer is the one
 * that reaches the commitment ledger.
 */

import { useId, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Button, Input } from '@erp/ui';

import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, QUANTITY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import { extendedAmountMinor, sumExtendedAmountMinor } from '../quantities';
import type {
  Material,
  MaterialRequest,
  MrLineAllocationPayload,
  ProcurementLineType,
  SpendCategory,
} from '../types';
import { MaterialPicker, UomDisplay } from './material-picker';

export interface PoLineDraft {
  key: string;
  lineType: ProcurementLineType;
  material: Material | null;
  description: string;
  uomCode: string;
  quantity: string;
  unitPrice: string;
  spendCategoryId: string;
  allocations: MrLineAllocationPayload[];
}

export function emptyPoLine(key: string): PoLineDraft {
  return {
    key,
    lineType: 'MATERIAL',
    material: null,
    description: '',
    uomCode: '',
    quantity: '',
    unitPrice: '',
    spendCategoryId: '',
    allocations: [],
  };
}

export type PoLineError =
  | 'materialRequired'
  | 'descriptionRequired'
  | 'quantityMustBePositive'
  | 'priceMustBePositive';

/**
 * Mirrors `purchase-order.service.ts`'s line rules. `unitPrice` is `@IsPositive()`, so a
 * zero-price line is refused server-side — a free-of-charge item has to be handled some
 * other way, and saying so here beats an unexplained 400.
 */
export function poLineError(line: PoLineDraft): PoLineError | null {
  if (line.lineType === 'MATERIAL' && !line.material) return 'materialRequired';
  if (line.description.trim().length === 0) return 'descriptionRequired';

  const qty = parseMinorUnits(line.quantity, QUANTITY_SCALE);
  if (qty === null || qty <= 0) return 'quantityMustBePositive';

  const price = parseMinorUnits(line.unitPrice, MONEY_SCALE);
  if (price === null || price <= 0) return 'priceMustBePositive';

  return null;
}

/** Minor units for a line, or nulls when the user has not finished typing. */
export function lineAmounts(line: PoLineDraft) {
  const quantityMinor = parseMinorUnits(line.quantity, QUANTITY_SCALE);
  const unitPriceMinor = parseMinorUnits(line.unitPrice, MONEY_SCALE);
  const extendedMinor =
    quantityMinor !== null && unitPriceMinor !== null
      ? extendedAmountMinor(quantityMinor, unitPriceMinor)
      : null;

  return { quantityMinor, unitPriceMinor, extendedMinor };
}

/** Order total across all complete lines. Incomplete lines contribute nothing. */
export function orderTotalMinor(lines: readonly PoLineDraft[]): number | null {
  const complete = lines
    .map(lineAmounts)
    .filter(
      (a): a is { quantityMinor: number; unitPriceMinor: number; extendedMinor: number } =>
        a.quantityMinor !== null && a.unitPriceMinor !== null,
    );

  return sumExtendedAmountMinor(complete);
}

interface PoLineEditorProps {
  lines: PoLineDraft[];
  onChange: (lines: PoLineDraft[]) => void;
  spendCategories: SpendCategory[];
  /** Approved requests whose lines can be allocated against. */
  approvedRequests: MaterialRequest[];
  currencyCode: string;
  showErrors: boolean;
}

export function PoLineEditor({
  lines,
  onChange,
  spendCategories,
  approvedRequests,
  currencyCode,
  showErrors,
}: PoLineEditorProps) {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');
  const locale = useLocale() as 'en' | 'ar';

  const update = (key: string, patch: Partial<PoLineDraft>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const total = orderTotalMinor(lines);

  return (
    <div className="space-y-3">
      {lines.map((line, index) => (
        <PoLineRow
          key={line.key}
          line={line}
          index={index}
          spendCategories={spendCategories}
          approvedRequests={approvedRequests}
          currencyCode={currencyCode}
          error={showErrors ? poLineError(line) : null}
          canRemove={lines.length > 1}
          onPatch={(patch) => update(line.key, patch)}
          onSelectMaterial={(material) =>
            update(line.key, {
              material,
              uomCode: material?.baseUom?.code ?? '',
              description:
                line.description.trim().length === 0 && material
                  ? material.name
                  : line.description,
            })
          }
          onChangeType={(lineType) =>
            update(line.key, {
              lineType,
              material: null,
              uomCode: lineType === 'MATERIAL' ? '' : line.uomCode,
            })
          }
          onRemove={() => onChange(lines.filter((l) => l.key !== line.key))}
        />
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange([...lines, emptyPoLine(`line-${Date.now()}-${lines.length}`)])}
        >
          {tc('addLine')}
        </Button>

        <p className="text-sm" aria-live="polite">
          <span className="text-muted-foreground">{tc('total')}: </span>
          <span className="font-semibold tabular-nums">
            {total === null
              ? tc('notAvailable')
              : formatMoney(fromMinorUnits(total, MONEY_SCALE), currencyCode, locale)}
          </span>
        </p>
      </div>

      {/* The running total is a preview computed here; the server recomputes every
          extendedAmount on save and its figures are what reach the commitment ledger. */}
      <p className="text-xs text-muted-foreground">{t('totalIsPreview')}</p>
    </div>
  );
}

function PoLineRow({
  line,
  index,
  spendCategories,
  approvedRequests,
  currencyCode,
  error,
  canRemove,
  onPatch,
  onSelectMaterial,
  onChangeType,
  onRemove,
}: {
  line: PoLineDraft;
  index: number;
  spendCategories: SpendCategory[];
  approvedRequests: MaterialRequest[];
  currencyCode: string;
  error: PoLineError | null;
  canRemove: boolean;
  onPatch: (patch: Partial<PoLineDraft>) => void;
  onSelectMaterial: (m: Material | null) => void;
  onChangeType: (t: ProcurementLineType) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');
  const tType = useTranslations('procurement.lineType');
  const tMr = useTranslations('procurement.mr');
  const locale = useLocale() as 'en' | 'ar';
  const [linking, setLinking] = useState(false);

  const ids = {
    type: useId(),
    description: useId(),
    quantity: useId(),
    price: useId(),
    spend: useId(),
  };

  const isMaterial = line.lineType === 'MATERIAL';
  const { extendedMinor } = lineAmounts(line);

  /** Flattened approved MR lines, labelled so the picker can be a plain select. */
  const allocatable = approvedRequests.flatMap((mr) =>
    mr.lines.map((mrLine) => ({
      id: mrLine.id,
      label: `${mr.mrNumber} · ${tc('lineNumber')}${mrLine.lineNumber} · ${mrLine.description}`,
    })),
  );

  return (
    <fieldset className="rounded-lg border border-border p-4">
      <legend className="px-1 text-xs font-semibold text-muted-foreground">
        {tc('lineNumber')}
        {index + 1}
      </legend>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor={ids.type} className="mb-1 block text-xs font-medium">
            {tc('type')}
          </label>
          <select
            id={ids.type}
            value={line.lineType}
            onChange={(e) => onChangeType(e.target.value as ProcurementLineType)}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm"
          >
            {(['MATERIAL', 'SERVICE', 'OTHER'] as const).map((type) => (
              <option key={type} value={type}>
                {tType(type)}
              </option>
            ))}
          </select>
        </div>

        {isMaterial ? (
          <div>
            <span className="mb-1 block text-xs font-medium">{tc('material')}</span>
            <MaterialPicker value={line.material} onSelect={onSelectMaterial} />
          </div>
        ) : null}

        <div>
          <label htmlFor={ids.description} className="mb-1 block text-xs font-medium">
            {tc('description')}
          </label>
          <Input
            id={ids.description}
            value={line.description}
            onChange={(e) => onPatch({ description: e.target.value })}
          />
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium">{tc('uom')}</span>
          <div className="flex min-h-11 items-center">
            <UomDisplay
              uom={line.material?.baseUom ?? null}
              locked={isMaterial}
              value={line.uomCode}
              onChange={(uomCode) => onPatch({ uomCode })}
            />
          </div>
        </div>

        <div>
          <label htmlFor={ids.quantity} className="mb-1 block text-xs font-medium">
            {t('orderedQuantity')}
          </label>
          <Input
            id={ids.quantity}
            inputMode="decimal"
            value={line.quantity}
            onChange={(e) => onPatch({ quantity: e.target.value })}
            className="text-end tabular-nums"
          />
        </div>

        <div>
          <label htmlFor={ids.price} className="mb-1 block text-xs font-medium">
            {tc('unitPrice')}
          </label>
          <Input
            id={ids.price}
            inputMode="decimal"
            value={line.unitPrice}
            onChange={(e) => onPatch({ unitPrice: e.target.value })}
            className="text-end tabular-nums"
          />
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium">{t('extendedAmount')}</span>
          <p className="flex min-h-11 items-center justify-end text-sm font-semibold tabular-nums">
            {extendedMinor === null
              ? tc('notAvailable')
              : formatMoney(fromMinorUnits(extendedMinor, MONEY_SCALE), currencyCode, locale)}
          </p>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={ids.spend} className="mb-1 block text-xs font-medium">
            {tc('spendCategory')} ({tc('optional')})
          </label>
          <select
            id={ids.spend}
            value={line.spendCategoryId}
            onChange={(e) => onPatch({ spendCategoryId: e.target.value })}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm"
          >
            <option value="">—</option>
            {spendCategories.flatMap((root) => [
              <option key={root.id} value={root.id}>
                {root.code} · {root.name}
              </option>,
              ...(root.children ?? []).map((child) => (
                <option key={child.id} value={child.id}>
                  {'  ↳ '}
                  {child.code} · {child.name}
                </option>
              )),
            ])}
          </select>
        </div>
      </div>

      {/* MR allocations. Optional, and strongly recommended by §6.29 — they are what
          attributes the commitment to a project and a BOQ node. */}
      <div className="mt-3 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium">{t('allocations')}</span>
          {line.allocations.map((alloc) => {
            const label = allocatable.find((a) => a.id === alloc.materialRequestLineId)?.label;
            return (
              <span
                key={alloc.materialRequestLineId}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
              >
                {label ?? alloc.materialRequestLineId}
                <button
                  type="button"
                  aria-label={tc('removeLine')}
                  onClick={() =>
                    onPatch({
                      allocations: line.allocations.filter(
                        (a) => a.materialRequestLineId !== alloc.materialRequestLineId,
                      ),
                    })
                  }
                  className="text-danger"
                >
                  ×
                </button>
              </span>
            );
          })}

          {allocatable.length > 0 ? (
            <button
              type="button"
              onClick={() => setLinking((v) => !v)}
              className="min-h-11 text-xs font-medium text-brand-primary underline-offset-2 hover:underline"
            >
              {t('linkToMr')}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">{tMr('empty')}</span>
          )}
        </div>

        {linking ? (
          <AllocationPicker
            allocatable={allocatable}
            onAdd={(materialRequestLineId, allocatedQuantity) => {
              onPatch({
                allocations: [
                  ...line.allocations.filter(
                    (a) => a.materialRequestLineId !== materialRequestLineId,
                  ),
                  { materialRequestLineId, allocatedQuantity },
                ],
              });
              setLinking(false);
            }}
          />
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        {error ? (
          <p className="text-xs font-medium text-danger" role="alert">
            {t(`lineError.${error}`)}
          </p>
        ) : (
          <span />
        )}

        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="min-h-11 shrink-0 text-xs font-medium text-danger underline-offset-2 hover:underline"
          >
            {tc('removeLine')}
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}

function AllocationPicker({
  allocatable,
  onAdd,
}: {
  allocatable: { id: string; label: string }[];
  onAdd: (materialRequestLineId: string, allocatedQuantity: number) => void;
}) {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');
  const ids = { line: useId(), qty: useId() };
  const [lineId, setLineId] = useState('');
  const [qty, setQty] = useState('');

  const minor = parseMinorUnits(qty, QUANTITY_SCALE);
  const valid = lineId !== '' && minor !== null && minor > 0;

  return (
    <div className="mt-3 grid gap-3 rounded-md bg-surface-subtle p-3 sm:grid-cols-[2fr_1fr_auto]">
      <div>
        <label htmlFor={ids.line} className="mb-1 block text-xs font-medium">
          {t('allocations')}
        </label>
        <select
          id={ids.line}
          value={lineId}
          onChange={(e) => setLineId(e.target.value)}
          className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm"
        >
          <option value="">—</option>
          {allocatable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={ids.qty} className="mb-1 block text-xs font-medium">
          {t('allocatedQuantity')}
        </label>
        <Input
          id={ids.qty}
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="text-end tabular-nums"
        />
      </div>

      <div className="flex items-end">
        <Button
          type="button"
          size="sm"
          disabled={!valid}
          onClick={() => onAdd(lineId, Number(fromMinorUnits(minor!, QUANTITY_SCALE)))}
        >
          {tc('save')}
        </Button>
      </div>
    </div>
  );
}
