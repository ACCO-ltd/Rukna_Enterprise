'use client';

import * as React from 'react';

import { Input, type InputProps } from './input';

/**
 * ─── MoneyInput — live thousands-grouping over a raw numeric string ──────────────
 *
 * The field DISPLAYS grouped digits (`1,234,567.89`) while the parent still holds the
 * canonical, separator-free string (`1234567.89`) — which is exactly what the API, the
 * validators and `parseMinorUnits` consume. Nothing downstream has to learn about commas.
 *
 * The value is fully controlled: what shows is always `formatThousands(props.value)`, so
 * there is no second copy of the number to drift. On every edit the input is re-parsed to a
 * clean raw string, the parent is updated, and the caret is mapped back to the same logical
 * position (counting only the digits/decimal point the user actually typed, never the commas
 * we inserted), so grouping while you type never throws the cursor to the end.
 */

const GROUP_EVERY_THREE = /\B(?=(\d{3})+(?!\d))/g;

/**
 * Groups the integer part of a raw numeric string and leaves the fraction — and a
 * still-being-typed trailing `.` — exactly as given. Input must already be canonical
 * (`sanitizeMoney`): digits, at most one `.`, optional leading `-`.
 */
export function formatThousands(raw: string): string {
  if (raw === '' || raw === '-') return raw;

  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const dot = unsigned.indexOf('.');

  const whole = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fraction = dot === -1 ? '' : unsigned.slice(dot + 1);
  const grouped = whole.replace(GROUP_EVERY_THREE, ',');

  return `${negative ? '-' : ''}${grouped}${dot === -1 ? '' : `.${fraction}`}`;
}

/**
 * Reduces arbitrary typed text to a canonical numeric string: strips grouping and any other
 * non-numeric character, keeps only the first `.`, drops leading zeros (so `007` → `7` but
 * `0` and `0.5` survive), and clamps the fraction to `maxFractionDigits`.
 */
export function sanitizeMoney(input: string, maxFractionDigits: number): string {
  let s = input.replace(/[^\d.]/g, '');

  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    // Keep the first dot, remove any later ones.
    s = `${s.slice(0, firstDot + 1)}${s.slice(firstDot + 1).replace(/\./g, '')}`;
  }

  let [whole = '', fraction = ''] = s.split('.');
  whole = whole.replace(/^0+(?=\d)/, '');
  const hasDot = firstDot !== -1;

  if (maxFractionDigits >= 0) fraction = fraction.slice(0, maxFractionDigits);

  return hasDot ? `${whole}.${fraction}` : whole;
}

function countMeaningful(text: string): number {
  // Everything that survives sanitizing (digits and the dot) is "meaningful"; commas are not.
  return (text.match(/[\d.]/g) ?? []).length;
}

/** Index in `formatted` just after the Nth non-comma character. */
function caretAfterMeaningful(formatted: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (formatted[i] !== ',') {
      seen += 1;
      if (seen === count) return i + 1;
    }
  }
  return formatted.length;
}

export interface MoneyInputProps
  extends Omit<InputProps, 'value' | 'onChange' | 'type' | 'inputMode'> {
  /** Canonical, separator-free numeric string — e.g. `"1234.5"` or `""`. */
  value: string;
  /** Receives the canonical (comma-free) string on every edit. */
  onValueChange: (raw: string) => void;
  /** Digits allowed after the decimal point. Money is 2; pass 3 for quantities. */
  maxFractionDigits?: number;
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onValueChange, maxFractionDigits = 2, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const pendingCaret = React.useRef<number | null>(null);

    const setRefs = React.useCallback(
      (el: HTMLInputElement | null) => {
        innerRef.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
      },
      [ref],
    );

    // Runs after every commit; only acts when an edit queued a caret position, so it never
    // fights a user selection made by clicking or arrow keys.
    React.useLayoutEffect(() => {
      if (pendingCaret.current !== null && innerRef.current) {
        const pos = pendingCaret.current;
        innerRef.current.setSelectionRange(pos, pos);
        pendingCaret.current = null;
      }
    });

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const el = event.target;
      const selectionStart = el.selectionStart ?? el.value.length;

      const meaningfulBeforeCaret = countMeaningful(
        sanitizeMoney(el.value.slice(0, selectionStart), maxFractionDigits),
      );
      const sanitized = sanitizeMoney(el.value, maxFractionDigits);
      const nextDisplay = formatThousands(sanitized);

      pendingCaret.current = caretAfterMeaningful(nextDisplay, meaningfulBeforeCaret);
      onValueChange(sanitized);
    };

    return (
      <Input
        ref={setRefs}
        type="text"
        inputMode="decimal"
        value={formatThousands(value)}
        onChange={handleChange}
        {...props}
      />
    );
  },
);
MoneyInput.displayName = 'MoneyInput';
