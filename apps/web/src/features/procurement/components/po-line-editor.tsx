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
 * ─── A3: cost target (BOQ node) is not captured on a PO line today ──────────────────
 *
 * A purchase order has no project association in the current model: neither
 * `CreatePurchaseOrderPayload` nor `CreatePoLinePayload` carries `projectId` or
 * `boqNodeId`, and the `POST /procurement/purchase-orders` DTO has no cost-target field.
 * Project-cost attribution previously flowed only *indirectly* through the MR allocations
 * D2 removes. So there is nothing to send a chosen cost target to, and a picker whose
 * value went nowhere would be a control that does nothing (doctrine §4 — honesty rule).
 *
 * The line therefore shows a read-only note that cost attribution is not captured here
 * yet, instead of inventing a project/BOQ field. The authoritative
 * "project-cost-relevant → cost target required per line, with a Not-chargeable opt-out"
 * invariant belongs on the backend: it needs a `projectId`/`boqNodeId` on the PO-line
 * contract before the frontend can enforce it. Tracked as an A3 backend request.
 */

import { useId } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Badge, Input, MoneyInput } from '@erp/ui';

import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, QUANTITY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import { extendedAmountMinor, sumExtendedAmountMinor } from '../quantities';
import type { Material, ProcurementLineType } from '../types';
import { MaterialPicker, UomDisplay } from './material-picker';

export interface PoLineDraft {
  key: string;
  lineType: ProcurementLineType;
  material: Material | null;
  description: string;
  uomCode: string;
  quantity: string;
  unitPrice: string;
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

      {/* Line classification — read-only, toward D7 consistency.
          Spend category is derived at issue, not chosen here; cost target is not captured
          on a PO line in the current model (see the A3 note at the top of this file). */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3">
        <span className="inline-flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{tc('spendCategory')}:</span>
          <Badge tone="neutral">{t('derivedOnIssue')}</Badge>
        </span>
        <span className="text-xs text-muted-foreground">{t('costTargetNotCaptured')}</span>
      </div>

      {error ? (
        <p className="mt-3 text-xs font-medium text-danger" role="alert">
          {t(`lineError.${error}`)}
        </p>
      ) : null}
    </fieldset>
  );
}
