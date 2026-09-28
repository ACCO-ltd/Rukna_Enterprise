'use client';

import { useId, useRef, useState } from 'react';
import { cn } from '@erp/ui';

/**
 * A boxed, always-visible field in the draft BOQ grid.
 *
 * The draft is a document being written, so its cells are inputs at rest — a QS repricing a bill
 * tabs from rate to rate rather than clicking each one open. Each field saves itself on blur or
 * Enter through the one node-update endpoint (`PATCH …/nodes/:id`); there is no per-cell autosave
 * endpoint, so "save on blur" is the honest cadence.
 *
 * States, per field:
 *  - saving  → read-only with `aria-busy`, so a second edit cannot race the first;
 *  - failed  → danger border, `aria-invalid`, and a one-line message under the field; the typed
 *              value stays so nothing is lost, and the next blur/Enter retries;
 *  - invalid → same presentation, raised before any request (wrong decimal places, empty text).
 * Escape restores the saved value.
 *
 * When not focused, the field follows the server value, so a refetch after someone else's save
 * (or this row's own) shows the stored figure rather than a stale draft.
 */

export type CellKind = 'text' | 'textarea' | 'unit' | 'quantity' | 'rate';

const PATTERNS: Record<'quantity' | 'rate', RegExp> = {
  quantity: /^\d+(\.\d{1,3})?$/,
  rate: /^\d+(\.\d{1,2})?$/,
};

const MAX_TEXT = 500;
const MAX_UNIT = 20;

export function normalizeCellValue(kind: CellKind, raw: string): string {
  const trimmed = raw.trim();
  // Thousands separators and stray spaces are how numbers get pasted from a sheet.
  return kind === 'quantity' || kind === 'rate' ? trimmed.replace(/[,\s]/g, '') : trimmed;
}

/** "180.000" → "180", "6.50" → "6.5": the input shows the number, not the column's scale. */
export function seedCellValue(kind: CellKind, value: string | null): string {
  if (value === null) return '';
  if ((kind === 'quantity' || kind === 'rate') && /^\d+\.\d+$/.test(value)) {
    return value.replace(/\.?0+$/, '');
  }
  return value;
}

/** Unchanged means no request — "180" against a stored "180.000" is the same number. */
export function sameCellValue(kind: CellKind, next: string, stored: string | null): boolean {
  if (kind === 'quantity' || kind === 'rate') {
    if (next === '' || stored === null) return next === '' && stored === null;
    return Number(next) === Number(stored);
  }
  return next === (stored ?? '');
}

export function isValidCellValue(kind: CellKind, value: string): boolean {
  if (kind === 'text' || kind === 'textarea') return value.length > 0 && value.length <= MAX_TEXT;
  if (kind === 'unit') return value.length <= MAX_UNIT;
  return value === '' || PATTERNS[kind].test(value);
}

export function CellEditor({
  value,
  kind,
  ariaLabel,
  onCommit,
  errorText,
  placeholder,
  attention = false,
  autoFocus = false,
  unitsListId,
  currencySymbol = '$',
  className,
  onEmptyCommit,
}: {
  value: string | null;
  kind: CellKind;
  ariaLabel: string;
  /** Persists the value. Rejects on failure, which the field shows and keeps for a retry. */
  onCommit: (next: string) => Promise<void>;
  /** "Couldn't save. Try again." — shown under a failed or invalid field. */
  errorText: string;
  placeholder?: string;
  /** Unpriced rate: an attention border at rest, before anyone has typed. */
  attention?: boolean;
  autoFocus?: boolean;
  /** `id` of a `<datalist>` of known units, for `kind="unit"`. */
  unitsListId?: string;
  /** Adornment before a rate — the BOQ's own currency, never assumed. */
  currencySymbol?: string;
  className?: string;
  /** Called instead of `onCommit` when a text field is left empty (e.g. abandon a new line). */
  onEmptyCommit?: () => void;
}) {
  const [draft, setDraft] = useState(() => seedCellValue(kind, value));
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const cancelled = useRef(false);
  // Guards against a second PATCH: Enter then Tab (blur) would otherwise both commit, and a blur
  // between a successful save and the refetch would resend the same value.
  const inFlight = useRef(false);
  const lastSaved = useRef<string | null>(null);
  const errorId = useId();

  // Follow the server value while the field is idle (React's "adjust state on prop change"
  // pattern — no effect, so no extra render pass). A focused or failed field keeps what was typed.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue && !focused && !failed) {
    setSyncedValue(value);
    setDraft(seedCellValue(kind, value));
  }


  const numeric = kind === 'quantity' || kind === 'rate';

  const commit = async () => {
    if (inFlight.current) return;
    const next = normalizeCellValue(kind, draft);
    if (sameCellValue(kind, next, value) || (lastSaved.current !== null && sameCellValue(kind, next, lastSaved.current))) {
      setFailed(false);
      return;
    }
    if ((kind === 'text' || kind === 'textarea') && next === '' && onEmptyCommit) {
      onEmptyCommit();
      return;
    }
    if (!isValidCellValue(kind, next)) {
      setFailed(true);
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      await onCommit(next);
      lastSaved.current = next;
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const fieldClass = cn(
      'w-full min-w-0 rounded-control border bg-surface px-2 py-1.5 text-body-sm text-foreground',
      'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:shadow-ring',
      numeric && 'text-end tabular-nums',
      saving && 'opacity-70',
      failed ? 'border-danger' : attention ? 'border-warning' : 'border-border-strong',
  );

  const shared = {
    value: draft,
    'aria-label': ariaLabel,
    'aria-invalid': failed || undefined,
    'aria-describedby': failed ? errorId : undefined,
    'aria-busy': saving || undefined,
    readOnly: saving,
    placeholder,
    autoFocus,
    onClick: (event: React.MouseEvent) => event.stopPropagation(),
    onFocus: () => {
      cancelled.current = false;
      setFocused(true);
    },
    onBlur: () => {
      setFocused(false);
      if (cancelled.current) {
        cancelled.current = false;
        return;
      }
      void commit();
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !(kind === 'textarea' && event.shiftKey)) {
        event.preventDefault();
        void commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelled.current = true;
        setDraft(seedCellValue(kind, value));
        setFailed(false);
        if (!value && onEmptyCommit) onEmptyCommit();
        event.currentTarget.blur();
      }
    },
  };

  return (
    <div className={cn('min-w-0', className)}>
      {kind === 'textarea' ? (
        <textarea
          {...shared}
          rows={1}
          maxLength={MAX_TEXT}
          // Grows with its content: a long description wraps instead of scrolling inside one line.
          className={cn(fieldClass, 'block resize-none [field-sizing:content]')}
          onChange={(event) => {
            setDraft(event.target.value);
            setFailed(false);
          }}
        />
      ) : (
        <div className={cn(kind === 'rate' && 'relative')}>
          {kind === 'rate' ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 start-2 flex items-center text-caption text-muted-foreground"
            >
              {currencySymbol}
            </span>
          ) : null}
          <input
            {...shared}
            type="text"
            inputMode={numeric ? 'decimal' : undefined}
            list={kind === 'unit' ? unitsListId : undefined}
            maxLength={kind === 'unit' ? MAX_UNIT : kind === 'text' ? MAX_TEXT : undefined}
            className={cn(fieldClass, kind === 'rate' && 'ps-5')}
            onChange={(event) => {
              setDraft(event.target.value);
              setFailed(false);
            }}
          />
        </div>
      )}
      {failed ? (
        <p id={errorId} role="alert" className="mt-1 text-caption text-danger">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}
