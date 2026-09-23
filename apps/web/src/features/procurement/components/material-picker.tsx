'use client';

/**
 * Material and unit-of-measure pickers, and the quantity split readout.
 *
 * `MaterialPicker` filters **in the browser**. §12.10 specifies a debounced call to
 * `GET /procurement/materials?search=...`, and that parameter does not exist — the
 * controller reads `materialCategoryId` and `spendCategoryId` and ignores anything else
 * without complaining (P1). So the active catalogue is fetched once and matched locally.
 * There is nothing to debounce, and pretending otherwise would only add latency.
 *
 * This is correct for a catalogue of hundreds and wrong for one of tens of thousands.
 * When the search parameter lands, this component is where it goes.
 */

import { useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn, Combobox, Select, type ComboboxOption } from '@erp/ui';

import { formatNumber } from '@/lib/format';
import { QUANTITY_SCALE, fromMinorUnits } from '@/lib/money';

import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import { useCreateUom, useMaterials, useUoms } from '../hooks/use-procurement';
import { CreateInPickerDialog } from './create-in-picker-dialog';
import type { Material, UnitOfMeasure } from '../types';

interface MaterialPickerProps {
  value: Material | null;
  onSelect: (material: Material | null) => void;
  disabled?: boolean;
  /** Rendered under the field when the caller has a validation message. */
  error?: string;
}

export function MaterialPicker({ value, onSelect, disabled, error }: MaterialPickerProps) {
  const t = useTranslations('procurement.material');
  const tc = useTranslations('procurement.common');
  const pickerId = useId();

  const { data: materials, isLoading, isError } = useMaterials();

  // `Combobox` filters on `label` (name) and `hint` (code) itself — the same two fields the
  // hand-rolled version matched by hand.
  const options: ComboboxOption[] = useMemo(
    () =>
      (materials ?? []).map((material) => ({
        value: material.id,
        label: material.name,
        hint: material.code,
        meta: material.baseUom?.symbol,
      })),
    [materials],
  );

  if (value) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-2 rounded-control border border-border px-3 py-2">
        <span className="min-w-0 truncate text-sm">
          <span className="font-mono text-xs text-muted-foreground">{value.code}</span>
          <span className="mx-1.5" aria-hidden="true">
            ·
          </span>
          {value.name}
        </span>
        {disabled ? null : (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="shrink-0 text-xs font-medium text-brand-primary underline-offset-2 hover:underline"
          >
            {tc('cancel')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <Combobox
        id={pickerId}
        value=""
        onChange={(id) => {
          const material = (materials ?? []).find((m) => m.id === id);
          if (material) onSelect(material);
        }}
        options={options}
        placeholder={t('pickerPlaceholder')}
        searchPlaceholder={t('pickerPlaceholder')}
        emptyLabel={t('pickerNoMatch')}
        disabled={disabled || isLoading}
        invalid={Boolean(error)}
      />

      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      {isError ? <p className="mt-1 text-xs text-danger">{tc('loadFailed')}</p> : null}
    </div>
  );
}

// ─── Unit of measure ─────────────────────────────────────────────────────────────

interface UomDisplayProps {
  /** The resolved unit, when one is known. */
  uom: Pick<UnitOfMeasure, 'code' | 'symbol'> | null;
  /** Locked units come from the material and cannot be chosen (rule UOM-001). */
  locked: boolean;
  value?: string;
  onChange?: (uomCode: string) => void;
  disabled?: boolean;
}

/**
 * A locked unit renders as text, not as a disabled select.
 *
 * A disabled select still looks like a control the user could use if they had permission,
 * which invites them to look for the permission. This is not a permission — the unit
 * genuinely cannot be anything else, so it reads as a fact with the reason attached.
 */
export function UomDisplay({ uom, locked, value, onChange, disabled }: UomDisplayProps) {
  const t = useTranslations('procurement.uomDisplay');
  const tUom = useTranslations('procurement.uom');
  const tc = useTranslations('procurement.common');
  const { data: uoms } = useUoms();
  const { can } = usePermissions();
  const canManage = can(PROCUREMENT_PERMISSIONS.manageConfig);
  const create = useCreateUom();
  const [creating, setCreating] = useState(false);

  if (locked) {
    return (
      <span
        className="inline-flex items-center gap-1 text-sm text-muted-foreground"
        title={t('locked')}
      >
        <span aria-hidden="true">🔒</span>
        {uom?.symbol ?? uom?.code ?? '—'}
        <span className="sr-only">{t('locked')}</span>
      </span>
    );
  }

  return (
    <>
      <Select
        // The visible "Unit" text belongs to a <span>, not a <label htmlFor>, so without this
        // the control has no accessible name at all.
        aria-label={t('label')}
        value={value ?? ''}
        disabled={disabled}
        onChange={(value) => onChange?.(value)}
        // "No units of measure yet. Create one before adding materials." used to be advice with
        // nowhere to act on it; this is that instruction made reachable.
        createAction={
          canManage ? { label: tUom('new'), onSelect: () => setCreating(true) } : undefined
        }
      >
        <option value="">—</option>
        {(uoms ?? []).map((u) => (
          <option key={u.id} value={u.code}>
            {u.code} · {u.symbol}
          </option>
        ))}
      </Select>

      {creating ? (
        <CreateInPickerDialog
          title={tUom('createTitle')}
          fields={[
            { name: 'code', label: tc('code'), hint: tUom('codeHint'), uppercase: true, maxLength: 12, required: true, narrow: true },
            { name: 'name', label: tc('name'), required: true },
            { name: 'symbol', label: tUom('symbol'), hint: tUom('symbolHint'), required: true, narrow: true },
          ]}
          submitLabel={tUom('new')}
          isPending={create.isPending}
          error={create.error}
          onDismiss={() => {
            setCreating(false);
            create.reset();
          }}
          onSubmit={(values) =>
            create.mutate(
              { code: values.code ?? '', name: values.name ?? '', symbol: values.symbol ?? '' },
              {
                onSuccess: (created) => {
                  onChange?.(created.code);
                  setCreating(false);
                },
              },
            )
          }
        />
      ) : null}
    </>
  );
}

// ─── Quantity split ──────────────────────────────────────────────────────────────

interface QuantitySplitProps {
  receivedMinor: number;
  acceptedMinor: number;
  rejectedMinor: number;
}

/**
 * The three-way split on a goods receipt line, as a proportional bar (§12.10).
 *
 * The numbers carry the meaning and the bar is the glance — so the bar is
 * `aria-hidden` and the figures are what a screen reader gets, rather than a decorative
 * element being described.
 */
export function QuantitySplit({
  receivedMinor,
  acceptedMinor,
  rejectedMinor,
}: QuantitySplitProps) {
  const t = useTranslations('procurement.grn.split');
  const locale = useLocale() as 'en' | 'ar';

  /**
   * Through `formatNumber` rather than straight out of `fromMinorUnits`, which always
   * pads to the scale — a whole delivery of 24 tonnes would read "24.000". The trailing
   * zeros carry no information here and make the three figures harder to compare at a
   * glance; `formatNumber` also gives Arabic its own digits.
   */
  const show = (minor: number) =>
    formatNumber(fromMinorUnits(minor, QUANTITY_SCALE), locale) ?? '0';

  const acceptedPct =
    receivedMinor > 0 ? Math.round((acceptedMinor / receivedMinor) * 100) : 0;

  return (
    <div className="min-w-32">
      <p className="text-xs text-muted-foreground">
        {t('label', {
          received: show(receivedMinor),
          accepted: show(acceptedMinor),
          rejected: show(rejectedMinor),
        })}
      </p>
      <div
        aria-hidden="true"
        className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <span
          className={cn('block bg-brand-primary')}
          style={{ width: `${acceptedPct}%` }}
        />
        <span className="block flex-1 bg-danger" />
      </div>
    </div>
  );
}
