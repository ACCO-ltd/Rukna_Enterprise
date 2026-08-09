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
import { useTranslations } from 'next-intl';
import { Input, cn } from '@erp/ui';

import { QUANTITY_SCALE, fromMinorUnits } from '@/lib/money';

import { useMaterials, useUoms } from '../hooks/use-procurement';
import type { Material, UnitOfMeasure } from '../types';

interface MaterialPickerProps {
  value: Material | null;
  onSelect: (material: Material | null) => void;
  disabled?: boolean;
  /** Rendered under the field when the caller has a validation message. */
  error?: string;
}

/** Case-insensitive match on code or name, in either language. */
function matches(material: Material, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return (
    material.code.toLowerCase().includes(q) ||
    material.name.toLowerCase().includes(q) ||
    (material.nameAr?.toLowerCase().includes(q) ?? false)
  );
}

export function MaterialPicker({ value, onSelect, disabled, error }: MaterialPickerProps) {
  const t = useTranslations('procurement.material');
  const tc = useTranslations('procurement.common');
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const { data: materials, isLoading, isError } = useMaterials();

  const results = useMemo(() => {
    if (!materials) return [];
    return materials.filter((m) => matches(m, query)).slice(0, 50);
  }, [materials, query]);

  if (value) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
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
            onClick={() => {
              onSelect(null);
              setQuery('');
            }}
            className="shrink-0 text-xs font-medium text-brand-primary underline-offset-2 hover:underline"
          >
            {tc('cancel')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={t('pickerPlaceholder')}
        value={query}
        disabled={disabled || isLoading}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delayed so a click on an option lands before the list unmounts.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        aria-invalid={error ? true : undefined}
      />

      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      {isError ? <p className="mt-1 text-xs text-danger">{tc('loadFailed')}</p> : null}

      {open && !isLoading && !isError ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t('pickerNoMatch')}</li>
          ) : (
            results.map((material) => (
              <li key={material.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    onSelect(material);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-muted"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {material.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{material.name}</span>
                  {material.baseUom ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {material.baseUom.symbol}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
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
  const { data: uoms } = useUoms();

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
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
      className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm"
    >
      <option value="">—</option>
      {(uoms ?? []).map((u) => (
        <option key={u.id} value={u.code}>
          {u.code} · {u.symbol}
        </option>
      ))}
    </select>
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
  const show = (minor: number) => fromMinorUnits(minor, QUANTITY_SCALE);

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
