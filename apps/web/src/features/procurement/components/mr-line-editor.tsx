'use client';

/**
 * The items on a new material request — one `LineItemsEditor` row per item.
 *
 * An item is either picked from the materials catalogue or added as a one-off by typing its
 * name. The two are deliberately different shapes:
 *
 *  - **Catalogue item** — `lineType` MATERIAL. Unit and spend category are the material's own
 *    (rules CAT-001 / UOM-001: the server reads the material's base unit and ignores any other),
 *    so they are read-only here. A price the material carries prefills the estimate.
 *  - **One-off item** — free text, SERVICE or OTHER (default OTHER). The requester chooses the
 *    unit and, optionally, the spend category.
 *
 * Quantities and prices are held as typed strings and parsed to minor units for validation, so a
 * half-typed "1." is never rejected while it is being written.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { LineItemsEditor, MoneyInput, QuantityInput, Select, comboboxColumn, type LineColumn } from '@erp/ui';

import { formatMoney } from '@/lib/format';
import { MONEY_SCALE, QUANTITY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import { quantityToApi } from '../quantities';
import type { CreateMrLinePayload, Material, ProcurementLineType, SpendCategory, UnitOfMeasure } from '../types';

export interface MrItemDraft {
  /** Stable across re-renders so React keys survive a row being removed. */
  key: string;
  /** The picked catalogue material, or null for a one-off (or a row nothing is chosen on yet). */
  material: Material | null;
  /** The one-off item's typed name. For a catalogue item, the material's name. */
  description: string;
  lineType: ProcurementLineType;
  /** The one-off item's unit. A catalogue item's unit is the material's base unit. */
  uomCode: string;
  quantity: string;
  /** The requester's estimate, as typed. Blank stays blank — never a $0 estimate. */
  estimatedUnitPrice: string;
  spendCategoryId: string;
}

export type MrItemErrorKey = 'item' | 'unit' | 'quantity';
export type MrItemErrors = Partial<Record<MrItemErrorKey, MrItemErrorKey>>;

export function emptyMrItem(key: string): MrItemDraft {
  return {
    key,
    material: null,
    description: '',
    lineType: 'OTHER',
    uomCode: '',
    quantity: '',
    estimatedUnitPrice: '',
    spendCategoryId: '',
  };
}

export function isOneOff(item: MrItemDraft): boolean {
  return item.material === null && item.description.trim() !== '';
}

/** A price the catalogue offers for a material — its own estimate, else the last price paid. */
export function materialReferencePrice(material: Material): string | null {
  return material.estimatedUnitPrice ?? material.lastPurchasePrice ?? null;
}

/** Picking a catalogue material: unit, spend category and (when offered) price come with it. */
export function pickMaterial(item: MrItemDraft, material: Material): MrItemDraft {
  const price = materialReferencePrice(material);
  return {
    ...item,
    material,
    description: material.name,
    lineType: 'MATERIAL',
    uomCode: material.baseUom?.code ?? '',
    spendCategoryId: material.defaultSpendCategoryId ?? '',
    estimatedUnitPrice: price ?? item.estimatedUnitPrice,
  };
}

/** A one-off item named by what was typed. Keeps its type if it was already a one-off. */
export function oneOffItem(item: MrItemDraft, text: string): MrItemDraft {
  const wasOneOff = item.material === null;
  return {
    ...item,
    material: null,
    description: text.trim(),
    lineType: wasOneOff && item.lineType !== 'MATERIAL' ? item.lineType : 'OTHER',
    uomCode: wasOneOff ? item.uomCode : '',
    spendCategoryId: wasOneOff ? item.spendCategoryId : '',
  };
}

export function mrItemErrors(item: MrItemDraft): MrItemErrors {
  const errors: MrItemErrors = {};
  if (!item.material && item.description.trim() === '') errors.item = 'item';
  if (!item.material && !item.uomCode) errors.unit = 'unit';
  const quantity = parseMinorUnits(item.quantity, QUANTITY_SCALE);
  if (quantity === null || quantity <= 0) errors.quantity = 'quantity';
  return errors;
}

/** Quantity × estimated price in cents, or null when either is missing. */
function amountMinor(item: MrItemDraft): number | null {
  const quantity = parseMinorUnits(item.quantity, QUANTITY_SCALE);
  const price = parseMinorUnits(item.estimatedUnitPrice, MONEY_SCALE);
  if (quantity === null || price === null || item.estimatedUnitPrice.trim() === '') return null;
  return Math.round((quantity * price) / 10 ** QUANTITY_SCALE);
}

export function mrItemAmount(item: MrItemDraft): string | null {
  const minor = amountMinor(item);
  return minor === null ? null : fromMinorUnits(minor, MONEY_SCALE);
}

/** Σ of the estimated items, or null when none is estimated — an unestimated request is not $0. */
export function mrItemsTotal(items: readonly MrItemDraft[]): string | null {
  let total = 0;
  let any = false;
  for (const item of items) {
    const minor = amountMinor(item);
    if (minor === null) continue;
    any = true;
    total += minor;
  }
  return any ? fromMinorUnits(total, MONEY_SCALE) : null;
}

export function toMrLinePayload(item: MrItemDraft): CreateMrLinePayload {
  const quantity = parseMinorUnits(item.quantity, QUANTITY_SCALE) ?? 0;
  const price = item.estimatedUnitPrice.trim();
  return {
    lineType: item.material ? 'MATERIAL' : item.lineType,
    description: item.description.trim(),
    // Required by the DTO even on a MATERIAL line, where the server uses the material's base
    // unit (P7) — sending that same code is the honest value.
    uomCode: item.material?.baseUom?.code ?? item.uomCode,
    requestedQuantity: quantityToApi(quantity),
    ...(item.material ? { materialCode: item.material.code } : {}),
    // Blank stays absent: a zero estimate would route a real requirement as though it were
    // free (ADR-022 CONST-DOA-001).
    ...(price && Number.isFinite(Number(price)) ? { estimatedUnitPrice: Number(price) } : {}),
    ...(item.spendCategoryId ? { spendCategoryId: item.spendCategoryId } : {}),
  };
}

/** Roots and their children, in order, for a flat select. */
export function flattenSpendCategories(roots: readonly SpendCategory[]): SpendCategory[] {
  return roots.flatMap((root) => [root, ...(root.children ?? [])]);
}

export const mrItemControlId = (column: string, index: number) => `mr-item-${index}-${column}`;

/**
 * Moves focus to a control once the row it belongs to has rendered: the new row's item after
 * "Add an item", the row's type after "Add … as a one-off item" (the list closes without
 * returning focus, which would otherwise drop to the page).
 */
function focusAfterRender(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

interface MrItemsEditorProps {
  items: MrItemDraft[];
  onChange: (items: MrItemDraft[]) => void;
  materials: readonly Material[];
  uoms: readonly UnitOfMeasure[];
  spendCategories: readonly SpendCategory[];
  /** Errors appear once the requester has tried to save. */
  showErrors: boolean;
  /** Money-blind roles: no price, amount or total columns. */
  moneyVisible: boolean;
  onAdd: () => void;
}

export function MrItemsEditor({
  items,
  onChange,
  materials,
  uoms,
  spendCategories,
  showErrors,
  moneyVisible,
  onAdd,
}: MrItemsEditorProps) {
  const t = useTranslations('procurement.mr.create');
  const tCol = useTranslations('procurement.mr.create.columns');
  const tErr = useTranslations('procurement.mr.create.errors');
  const tc = useTranslations('procurement.common');

  const activeMaterials = useMemo(() => materials.filter((m) => m.status === 'ACTIVE'), [materials]);
  const spendOptions = useMemo(() => flattenSpendCategories(spendCategories), [spendCategories]);
  const spendName = (id: string) => {
    const found = spendOptions.find((s) => s.id === id);
    return found ? found.name : null;
  };

  const patch = (index: number, next: MrItemDraft) =>
    onChange(items.map((item, i) => (i === index ? next : item)));
  const update = (index: number, fields: Partial<MrItemDraft>) => patch(index, { ...items[index]!, ...fields });

  const muted = (text: string) => <span className="block pt-2 text-body-sm text-muted-foreground">{text}</span>;

  const columns: LineColumn<MrItemDraft>[] = [
    comboboxColumn<MrItemDraft, Material>({
      type: 'combobox',
      key: 'item',
      header: tCol('item'),
      required: true,
      // Wide enough that the trigger reads "Search materials" in full, not "Search mater…";
      // the list itself opens wider than the column so names and codes are not cut.
      width: 'minmax(11rem,2.4fr)',
      panelClassName: 'min-w-72',
      controlId: (i) => mrItemControlId('item', i),
      options: activeMaterials,
      getOptionValue: (m) => m.id,
      getOptionLabel: (m) => m.name,
      getOptionHint: (m) => m.code,
      getOptionCaption: (m) => m.baseUom?.symbol ?? m.baseUom?.code,
      value: (item) => item.material?.id ?? '',
      valueLabel: (item) => (item.material ? undefined : item.description || undefined),
      onPick: (item, i, material) => patch(i, pickMaterial(item, material)),
      onCreate: (item, i, text) => {
        patch(i, oneOffItem(item, text));
        focusAfterRender(mrItemControlId('type', i));
      },
      createLabel: (text) => (text ? t('addOneOff', { text }) : t('addOneOffEmpty')),
      placeholder: t('itemPlaceholder'),
      searchPlaceholder: t('itemSearch'),
      emptyLabel: t('itemEmpty'),
    }),
    {
      key: 'type',
      header: tCol('type'),
      width: '7.5rem',
      controlId: (i) => mrItemControlId('type', i),
      cell: (item, i) =>
        item.material ? (
          muted(t('typeMaterial'))
        ) : isOneOff(item) ? (
          <Select
            id={mrItemControlId('type', i)}
            value={item.lineType === 'SERVICE' ? 'SERVICE' : 'OTHER'}
            onChange={(value) => update(i, { lineType: value as ProcurementLineType })}
          >
            <option value="SERVICE">{t('typeService')}</option>
            <option value="OTHER">{t('typeOther')}</option>
          </Select>
        ) : (
          muted(tc('notAvailable'))
        ),
    },
    {
      key: 'unit',
      header: tCol('unit'),
      width: '6.5rem',
      controlId: (i) => mrItemControlId('unit', i),
      cell: (item, i) =>
        item.material ? (
          muted(item.material.baseUom?.symbol ?? item.material.baseUom?.code ?? tc('notAvailable'))
        ) : isOneOff(item) ? (
          <Select
            id={mrItemControlId('unit', i)}
            value={item.uomCode}
            onChange={(value) => update(i, { uomCode: value })}
          >
            <option value="">{t('chooseUnit')}</option>
            {uoms
              .filter((u) => u.status === 'ACTIVE')
              .map((u) => (
                <option key={u.id} value={u.code}>
                  {u.symbol || u.code}
                </option>
              ))}
          </Select>
        ) : (
          muted(tc('notAvailable'))
        ),
    },
    {
      key: 'quantity',
      header: tCol('quantity'),
      required: true,
      width: '7.5rem',
      align: 'end',
      controlId: (i) => mrItemControlId('quantity', i),
      cell: (item, i) => (
        <QuantityInput
          id={mrItemControlId('quantity', i)}
          value={item.quantity}
          onValueChange={(value) => update(i, { quantity: value })}
        />
      ),
    },
  ];

  if (moneyVisible) {
    columns.push(
      {
        key: 'price',
        header: tCol('price'),
        width: '8.5rem',
        align: 'end',
        controlId: (i) => mrItemControlId('price', i),
        cell: (item, i) => (
          <MoneyInput
            id={mrItemControlId('price', i)}
            value={item.estimatedUnitPrice}
            onValueChange={(value) => update(i, { estimatedUnitPrice: value })}
          />
        ),
      },
      {
        key: 'amount',
        header: tCol('amount'),
        width: '7.5rem',
        align: 'end',
        cell: (item) => {
          const amount = mrItemAmount(item);
          return (
            <span className="block pt-2 text-body-sm tabular-nums text-foreground">
              {amount === null ? <span className="text-muted-foreground">{tc('notAvailable')}</span> : formatMoney(amount, 'USD')}
            </span>
          );
        },
      },
    );
  }

  columns.push({
    key: 'spend',
    header: tCol('spend'),
    width: 'minmax(0,1.2fr)',
    controlId: (i) => mrItemControlId('spend', i),
    cell: (item, i) =>
      item.material ? (
        muted(spendName(item.spendCategoryId) ?? item.material.defaultSpendCategory?.name ?? tc('notAvailable'))
      ) : isOneOff(item) ? (
        <Select
          id={mrItemControlId('spend', i)}
          value={item.spendCategoryId}
          onChange={(value) => update(i, { spendCategoryId: value })}
        >
          <option value="">{t('chooseSpend')}</option>
          {spendOptions
            .filter((s) => s.status === 'ACTIVE')
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.parentId ? `  ${s.name}` : s.name}
              </option>
            ))}
        </Select>
      ) : (
        muted(tc('notAvailable'))
      ),
  });

  return (
    <LineItemsEditor<MrItemDraft>
      label={t('linesLabel')}
      rows={items}
      rowKey={(item) => item.key}
      columns={columns}
      errors={(i) => {
        if (!showErrors) return undefined;
        const errors = mrItemErrors(items[i]!);
        // A row with nothing chosen yet shows one error, on the item, not a unit error too.
        const unitShown = errors.unit && !errors.item;
        return {
          item: errors.item ? tErr('item') : undefined,
          unit: unitShown ? tErr('unit') : undefined,
          quantity: errors.quantity ? tErr('quantity') : undefined,
        };
      }}
      cardTitle={(item, i) =>
        item.description ? t('lineTitleNamed', { n: i + 1, name: item.description }) : t('lineTitle', { n: i + 1 })
      }
      onAdd={() => {
        onAdd();
        focusAfterRender(mrItemControlId('item', items.length));
      }}
      addLabel={t('addLine')}
      onRemove={items.length > 1 ? (index) => onChange(items.filter((_, i) => i !== index)) : undefined}
      removeLabel={(i) => t('removeLine', { n: i + 1 })}
    />
  );
}
