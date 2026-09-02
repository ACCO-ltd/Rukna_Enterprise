'use client';

/**
 * Purchase order line editor (Round 2, single-form).
 *
 * One card per line: type, material (on MATERIAL lines), description, unit, ordered
 * quantity, unit price, and the live extended amount. Two former line inputs are gone:
 *
 *  - **MR-link allocation picker (D2).** PO lines no longer reference material-request
 *    lines. A PO is fully valid with zero material requests, so the `AllocationPicker`,
 *    the `mrLineAllocations` payload, and the `approvedRequests` feed are all removed.
 *  - **Spend-category select (D7).** Spend category is no longer chosen on the line. It is
 *    shown as a quiet read-only chip ("Derived on issue"); the real derivation is backend
 *    work, not in this slice. `spendCategoryId` is OPTIONAL on the PO-line API, so it is
 *    simply omitted from the payload rather than sent as a typed value.
 *
 * `extendedAmount` is computed here in integer minor units and shown live. Quantity is
 * 3dp and price is 2dp, so their product is 5dp and has to come back to 2 — that scale
 * change is the one piece of arithmetic on this screen that is easy to get silently
 * wrong, and it lives in `extendedAmountMinor` (in `quantities.ts`) with its own tests
 * rather than inline.
 *
 * The value shown is a **preview**. The server recomputes it, and its answer is the one
 * that reaches the commitment ledger.
 *
 * ─── A3 / D7: the cost target is captured on the line (no. 148) ─────────────────────────
 *
 * The PO-line contract now carries `projectId` + `boqNodeId`, so the placeholder note is
 * replaced by a real {@link PoCostTargetPicker}. A line is project-cost-relevant by default —
 * project + BOQ node required — with a per-line "Not chargeable to a project cost line"
 * opt-out for org/overhead lines. `poLineCostTargetIncomplete` guards a half-specified line
 * (one id without the other), the exact state the server refuses with a 400; the create
 * payload sends both ids or neither. See `po-cost-target-picker.tsx` for the data sources.
 */

import { useId } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Badge, Input, MoneyInput, Select } from '@erp/ui';

import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, QUANTITY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import { extendedAmountMinor, sumExtendedAmountMinor } from '../quantities';
import type { Material, ProcurementLineType } from '../types';
import { MaterialPicker, UomDisplay } from './material-picker';
import {
  PoCostTargetPicker,
  emptyCostTarget,
  isCostTargetComplete,
  type CostTargetValue,
} from './po-cost-target-picker';

export interface PoLineDraft {
  key: string;
  lineType: ProcurementLineType;
  material: Material | null;
  description: string;
  uomCode: string;
  quantity: string;
  unitPrice: string;
  costTarget: CostTargetValue;
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
    costTarget: emptyCostTarget(),
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

/**
 * True when the line's cost-target is half-specified (a project without a node, or the
 * reverse) — the A3 both-or-neither invariant, mirrored from `validateCostTarget` on the
 * server. It is kept separate from `poLineError` so the field errors and the cost-target
 * error can render in their own places, but both block submit.
 */
export function poLineCostTargetIncomplete(line: PoLineDraft): boolean {
  return !isCostTargetComplete(line.costTarget);
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
  currencyCode: string;
  showErrors: boolean;
}

export function PoLineEditor({ lines, onChange, currencyCode, showErrors }: PoLineEditorProps) {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');

  const update = (key: string, patch: Partial<PoLineDraft>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-3">
      {lines.map((line, index) => (
        <PoLineRow
          key={line.key}
          line={line}
          index={index}
          currencyCode={currencyCode}
          error={showErrors ? poLineError(line) : null}
          showCostTargetError={showErrors}
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

      <button
        type="button"
        onClick={() => onChange([...lines, emptyPoLine(`line-${Date.now()}-${lines.length}`)])}
        className="min-h-11 text-sm font-medium text-brand-primary underline-offset-2 hover:underline"
      >
        {tc('addLine')}
      </button>

      {/* The running total is a preview computed here; the server recomputes every
          extendedAmount on save and its figures are what reach the commitment ledger.
          The value itself lives in the form's sticky footer (single primary action). */}
      <p className="text-xs text-muted-foreground">{t('totalIsPreview')}</p>
    </div>
  );
}

function PoLineRow({
  line,
  index,
  currencyCode,
  error,
  showCostTargetError,
  canRemove,
  onPatch,
  onSelectMaterial,
  onChangeType,
  onRemove,
}: {
  line: PoLineDraft;
  index: number;
  currencyCode: string;
  error: PoLineError | null;
  showCostTargetError: boolean;
  canRemove: boolean;
  onPatch: (patch: Partial<PoLineDraft>) => void;
  onSelectMaterial: (m: Material | null) => void;
  onChangeType: (t: ProcurementLineType) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');
  const tType = useTranslations('procurement.lineType');
  const locale = useLocale() as 'en';

  const ids = {
    type: useId(),
    description: useId(),
    quantity: useId(),
    price: useId(),
  };

  const isMaterial = line.lineType === 'MATERIAL';
  const { extendedMinor } = lineAmounts(line);

  return (
    <fieldset className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <legend className="px-1 text-xs font-semibold text-muted-foreground">
          {tc('lineNumber')}
          {index + 1}
        </legend>
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

      <div className="mt-1 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor={ids.type} className="mb-1 block text-xs font-medium">
            {tc('type')}
          </label>
          <Select
            id={ids.type}
            value={line.lineType}
            onChange={(value) => onChangeType(value as ProcurementLineType)}
          >
            {(['MATERIAL', 'SERVICE', 'OTHER'] as const).map((type) => (
              <option key={type} value={type}>
                {tType(type)}
              </option>
            ))}
          </Select>
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
          <MoneyInput
            id={ids.price}
            value={line.unitPrice}
            onValueChange={(v) => onPatch({ unitPrice: v })}
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
      </div>

      {/* Spend category — read-only, derived at issue (D7). It is not chosen here. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
        <span className="inline-flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{tc('spendCategory')}:</span>
          <Badge tone="neutral">{t('derivedOnIssue')}</Badge>
        </span>
      </div>

      {/* Cost target (A3/D7, no. 148): project + BOQ cost node, or the org/overhead opt-out. */}
      <PoCostTargetPicker
        value={line.costTarget}
        onChange={(costTarget) => onPatch({ costTarget })}
        showError={showCostTargetError}
      />

      {error ? (
        <p className="mt-3 text-xs font-medium text-danger" role="alert">
          {t(`lineError.${error}`)}
        </p>
      ) : null}
    </fieldset>
  );
}
