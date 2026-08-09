'use client';

/**
 * The material request line editor (§12.5, step 2).
 *
 * Two rules drive the whole component, and both come from `material-request.service.ts`
 * rather than from the design:
 *
 *  1. **A MATERIAL line must name a material** (rule CAT-001). Free text is for SERVICE
 *     and OTHER.
 *  2. **A MATERIAL line's unit is the material's own** (rule UOM-001). The server reads
 *     `material.baseUnitOfMeasureId` and ignores whatever `uomCode` was sent — but the
 *     field is still required by the DTO (P7), so the editor sends the material's base
 *     code. Locking the control is not cosmetic: it is the only honest representation of
 *     a value the user cannot influence.
 *
 * Quantities are held as **strings**, exactly as typed, and parsed to minor units for
 * validation. Holding a number would mean parsing on every keystroke, and `parseMinorUnits`
 * returns `null` for a half-typed "1." — the user would watch their own input be rejected
 * as they wrote it.
 */

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@erp/ui';

import { QUANTITY_SCALE, parseMinorUnits } from '@/lib/money';

import type { Material, ProcurementLineType, SpendCategory } from '../types';
import { validateMrLine, type MrLineError } from '../quantities';
import { MaterialPicker, UomDisplay } from './material-picker';

export interface MrLineDraft {
  /** Stable across re-renders so React keys survive a row being deleted. */
  key: string;
  lineType: ProcurementLineType;
  material: Material | null;
  description: string;
  uomCode: string;
  quantity: string;
  spendCategoryId: string;
}

export function emptyMrLine(key: string): MrLineDraft {
  return {
    key,
    lineType: 'MATERIAL',
    material: null,
    description: '',
    uomCode: '',
    quantity: '',
    spendCategoryId: '',
  };
}

/** The error for a line, or null. Exported so the parent can block submit on any. */
export function mrLineError(line: MrLineDraft): MrLineError | null {
  return validateMrLine({
    lineType: line.lineType,
    materialCode: line.material?.code ?? null,
    description: line.description,
    quantityMinor: parseMinorUnits(line.quantity, QUANTITY_SCALE),
  });
}

interface MrLineEditorProps {
  lines: MrLineDraft[];
  onChange: (lines: MrLineDraft[]) => void;
  spendCategories: SpendCategory[];
  /** Errors are only surfaced once the user has tried to submit. */
  showErrors: boolean;
}

export function MrLineEditor({
  lines,
  onChange,
  spendCategories,
  showErrors,
}: MrLineEditorProps) {
  const t = useTranslations('procurement.mr');
  const tc = useTranslations('procurement.common');

  const update = (key: string, patch: Partial<MrLineDraft>) => {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  /**
   * Choosing a material rewrites three fields at once. Description is filled from the
   * material name only when the user has not written their own — overwriting a typed
   * description because a material was picked afterwards would destroy their work.
   */
  const selectMaterial = (line: MrLineDraft, material: Material | null) => {
    update(line.key, {
      material,
      uomCode: material?.baseUom?.code ?? '',
      description:
        line.description.trim().length === 0 && material ? material.name : line.description,
      ...(material?.defaultSpendCategoryId && !line.spendCategoryId
        ? { spendCategoryId: material.defaultSpendCategoryId }
        : {}),
    });
  };

  /**
   * Switching away from MATERIAL clears the material and unlocks the unit; switching to
   * it clears a unit that was chosen freely, because it is about to be dictated.
   */
  const changeType = (line: MrLineDraft, lineType: ProcurementLineType) => {
    update(line.key, {
      lineType,
      material: null,
      uomCode: lineType === 'MATERIAL' ? '' : line.uomCode,
    });
  };

  return (
    <div className="space-y-3">
      {lines.map((line, index) => (
        <MrLineRow
          key={line.key}
          line={line}
          index={index}
          spendCategories={spendCategories}
          error={showErrors ? mrLineError(line) : null}
          canRemove={lines.length > 1}
          onChangeType={(type) => changeType(line, type)}
          onSelectMaterial={(m) => selectMaterial(line, m)}
          onPatch={(patch) => update(line.key, patch)}
          onRemove={() => onChange(lines.filter((l) => l.key !== line.key))}
        />
      ))}

      <Button
        type="button"
        variant="outline"
        onClick={() =>
          onChange([...lines, emptyMrLine(`line-${Date.now()}-${lines.length}`)])
        }
      >
        {tc('addLine')}
      </Button>

      <p className="sr-only" aria-live="polite">
        {t('linesTitle')}: {lines.length}
      </p>
    </div>
  );
}

function MrLineRow({
  line,
  index,
  spendCategories,
  error,
  canRemove,
  onChangeType,
  onSelectMaterial,
  onPatch,
  onRemove,
}: {
  line: MrLineDraft;
  index: number;
  spendCategories: SpendCategory[];
  error: MrLineError | null;
  canRemove: boolean;
  onChangeType: (t: ProcurementLineType) => void;
  onSelectMaterial: (m: Material | null) => void;
  onPatch: (patch: Partial<MrLineDraft>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('procurement.mr');
  const tc = useTranslations('procurement.common');
  const tType = useTranslations('procurement.lineType');
  const ids = {
    type: useId(),
    description: useId(),
    quantity: useId(),
    spend: useId(),
  };

  const isMaterial = line.lineType === 'MATERIAL';

  return (
    <fieldset className="rounded-lg border border-border p-4">
      <legend className="px-1 text-xs font-semibold text-muted-foreground">
        {tc('lineNumber')}
        {index + 1}
      </legend>

      {/* Stacks on narrow viewports; a nine-column grid is unusable at 375px. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <div className="sm:col-span-1">
            <span className="mb-1 block text-xs font-medium">{tc('material')}</span>
            <MaterialPicker value={line.material} onSelect={onSelectMaterial} />
          </div>
        ) : null}

        <div className={isMaterial ? 'sm:col-span-2 lg:col-span-1' : 'sm:col-span-1'}>
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
            {tc('quantity')}
          </label>
          <Input
            id={ids.quantity}
            inputMode="decimal"
            value={line.quantity}
            onChange={(e) => onPatch({ quantity: e.target.value })}
            className="text-end tabular-nums"
          />
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
