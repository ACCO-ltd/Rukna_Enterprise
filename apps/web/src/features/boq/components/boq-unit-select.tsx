'use client';

import { useId, useState } from 'react';
import type { UnitOfMeasureOption } from '@erp/types';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Notice, Select, cn } from '@erp/ui';

import { canonicalUnit, resolveListedUnit } from '@/features/units-of-measure/unit-aliases';

/**
 * The BOQ unit picker — the org's unit registry (`useUnitsOfMeasure`), never free text.
 *
 * Owner decision (ADR-039, PR 2): a unit comes from the list only. A BOQ node stores the unit as
 * text, and the value written is the unit's **symbol** (`m³`, `t`, `nr`), which is what a bill
 * is read with and what the grid prints after a quantity.
 *
 * ─── Legacy units ────────────────────────────────────────────────────────────────
 *
 * Bills written before the registry was readable hold whatever was typed. A spelling of a listed
 * unit (`m2`, `sqm`, `Nos`, `LS`) resolves to it (`unit-aliases.ts`) and shows as that unit, with
 * no warning; saving the line then sends the listed symbol. Only a truly unknown unit is shown as
 * an extra row marked "Not listed" — kept, so opening an old line never silently blanks it.
 */
export function isListedUnit(units: readonly UnitOfMeasureOption[], value: string): boolean {
  return value === '' || resolveListedUnit(units, value) !== null;
}

const SEARCHABLE_UNITS_FROM = 20;

export function BoqUnitSelect({
  id,
  value,
  units,
  onChange,
  disabled,
  compact = false,
  placeholder,
  ariaLabel,
  ariaDescribedBy,
  busy = false,
  invalid = false,
  attention = false,
  className,
}: {
  id?: string;
  /** The stored unit text; `''` when none. */
  value: string;
  units: readonly UnitOfMeasureOption[];
  onChange: (symbol: string) => void;
  disabled?: boolean;
  /**
   * The grid cell: a shorter trigger that shows the symbol alone. The unit's name still shows in
   * the open list.
   */
  compact?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  /** Saving: announced as unavailable but still focusable (see `UnitCellEditor`). */
  busy?: boolean;
  /** A failed save, outside a FormField (the grid). Inside one, the field's error drives it. */
  invalid?: boolean;
  /** The grid's attention border — a legacy unit, as an unpriced rate is flagged beside it. */
  attention?: boolean;
  className?: string;
}) {
  const t = useTranslations('platform.boq.units');
  const legacy = !isListedUnit(units, value);
  const shown = canonicalUnit(units, value);

  return (
    <Select
      id={id}
      value={shown}
      onChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-disabled={busy}
      placeholder={placeholder ?? t('placeholder')}
      // A unit list is scanned by symbol, and the filtering Combobox flattens each row to text —
      // it would print "LS Lump sum" in a grid cell. The standard set (nine units) stays a plain
      // list; only a registry long enough to need a filter gets one.
      searchable={units.length > SEARCHABLE_UNITS_FROM}
      searchPlaceholder={t('search')}
      noMatchLabel={t('noMatch')}
      className={cn(
        // `h-control` is not a height tailwind-merge recognises, so the grid's shorter row is a
        // cap rather than a competing `h-*`.
        compact && 'max-h-8 px-2 py-1 [&_[data-unit-name]]:hidden',
        invalid ? 'border-danger' : attention && 'border-warning',
        className,
      )}
    >
      {/* The empty choice exists only while there is no unit: the node API cannot clear a unit
          (no null on the DTO), so offering "—" on a line that has one would promise a save that
          silently does nothing. */}
      {value === '' ? <option value="">{placeholder ?? t('placeholder')}</option> : null}
      {legacy ? (
        <option value={value}>
          {value}{' '}
          <span data-unit-name="" className="ms-1 font-normal text-warning">
            {t('notListed')}
          </span>
        </option>
      ) : null}
      {uniqueBySymbol(units).map((unit) => (
        <option key={unit.code} value={unit.symbol}>
          {unit.symbol}{' '}
          <span data-unit-name="" className="ms-1 font-normal text-muted-foreground">
            {unit.name}
          </span>
        </option>
      ))}
    </Select>
  );
}

/** One row per symbol: the stored value is the symbol, so two rows with one symbol would be one choice. */
function uniqueBySymbol(units: readonly UnitOfMeasureOption[]): UnitOfMeasureOption[] {
  const seen = new Set<string>();
  return units.filter((unit) => {
    if (seen.has(unit.symbol)) return false;
    seen.add(unit.symbol);
    return true;
  });
}

/**
 * The grid's unit cell on an editable draft: the same list-only picker, compact, saving itself on
 * choice through the one node-update endpoint — the unit's counterpart of `CellEditor`.
 *
 * States: saving (disabled, `aria-busy`), failed (danger caption; the chosen unit stays so the
 * next choice retries), legacy (the stored unit is kept, with an attention border, "Not listed" in
 * the trigger's description and the full note as a tooltip). With no
 * registry to choose from — loading, empty, or unreadable — it shows the stored unit as text; the
 * workspace says why once, above the grid, rather than in every row.
 */
export function UnitCellEditor({
  value,
  units,
  ariaLabel,
  errorText,
  onCommit,
  className,
}: {
  value: string | null;
  /** The registry, or undefined while it is not available. */
  units: readonly UnitOfMeasureOption[] | undefined;
  ariaLabel: string;
  errorText: string;
  onCommit: (next: string) => Promise<void>;
  className?: string;
}) {
  const t = useTranslations('platform.boq.units');
  const stored = value ?? '';
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const errorId = useId();
  const noteId = useId();

  // Follow the server value while idle ("adjust state on prop change" — no effect).
  const [synced, setSynced] = useState(stored);
  if (stored !== synced && !saving && !failed) {
    setSynced(stored);
    setDraft(stored);
  }

  if (!units || units.length === 0) {
    return <span className={cn('text-body-sm', className)}>{stored || '—'}</span>;
  }

  const legacy = !isListedUnit(units, draft);

  const choose = async (next: string) => {
    // Busy, not disabled: a disabled trigger loses focus when the list closes, and Tab from the
    // cell would start again at the top of the page. Input is ignored instead.
    if (saving) return;
    setDraft(next);
    // Picking the unit a stored alias already resolves to changes nothing worth a request.
    if (next === canonicalUnit(units, stored)) {
      setFailed(false);
      return;
    }
    setSaving(true);
    try {
      await onCommit(next);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    // The row opens the dialog on a phone tap; a choice here is not that.
    <div
      title={legacy && !failed ? t('legacyNote') : undefined}
      className={cn('min-w-0', saving && 'opacity-70', className)}
      aria-busy={saving || undefined}
      onClick={(event) => event.stopPropagation()}
    >
      <BoqUnitSelect
        value={draft}
        units={units}
        compact
        busy={saving}
        placeholder="—"
        ariaLabel={ariaLabel}
        ariaDescribedBy={failed ? errorId : legacy ? noteId : undefined}
        invalid={failed}
        attention={legacy}
        onChange={(next) => void choose(next)}
      />
      {failed ? (
        <p id={errorId} role="alert" className="mt-1 text-caption text-danger">
          {errorText}
        </p>
      ) : legacy ? (
        // Old bills carry many typed units; a caption under every one would bury the grid. The
        // cell gets the attention border the unpriced rate uses, and the reason is its description.
        <span id={noteId} className="sr-only">
          {t('legacyShort')}
        </span>
      ) : null}
    </div>
  );
}

/**
 * "No units of measure are set up yet" / "Could not load the units" — and where to fix it: a link
 * to Procurement setup for someone who may manage units, otherwise "Ask an administrator".
 */
export function UnitsUnavailableNotice({
  reason,
  adminHref,
}: {
  reason: 'empty' | 'error';
  adminHref: string | null;
}) {
  const t = useTranslations('platform.boq.units');
  return (
    <Notice tone="attention">
      {reason === 'error' ? t('loadFailed') : t('empty')}{' '}
      {adminHref ? (
        <Link href={adminHref} className="font-medium text-brand-primary underline-offset-2 hover:underline">
          {t('manageLink')}
        </Link>
      ) : (
        t('askAdmin')
      )}
    </Notice>
  );
}
