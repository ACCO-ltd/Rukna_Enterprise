'use client';

import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Checkboxes and radios.
 *
 * ─── Why these did not exist ─────────────────────────────────────────────────────
 *
 * The library shipped Input, Select, Textarea, DatePicker and MoneyInput but no checkbox and
 * no radio, so fifteen screens wrote their own. They did not agree: three different sizings
 * across `platform-data-grid`, `create-account-form` and `role-multi-select`, two different
 * ideas of which token colours a tick, and radios with no styling at all. A design system
 * missing a checkbox is not a system with a gap — it is a system that is silently overridden
 * fifteen times.
 *
 * ─── Why native, and why `accent-color` ──────────────────────────────────────────
 *
 * Both controls keep `appearance: auto` and are tinted with `accent-color` rather than
 * redrawn with an SVG behind a hidden input. That keeps the platform's own tick, its
 * indeterminate dash, its Windows high-contrast rendering and its assistive-technology
 * semantics — all of which a custom control has to reimplement and usually reimplements
 * incompletely. The cost is that the unchecked border is the browser's rather than
 * `--border-strong`; that is the cheaper half of the trade.
 */

// ─── Checkbox ─────────────────────────────────────────────────────────────────

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /**
   * Partial selection — a select-all above rows where only some are selected.
   *
   * This is the state a hand-rolled checkbox always drops, because it cannot be set from
   * markup: `indeterminate` is a DOM property, not an attribute. `PlatformDataGrid` rendered
   * its select-all as *unchecked* on a partial selection, which reads as "nothing is
   * selected" while rows are in fact selected.
   */
  indeterminate?: boolean;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate, ...props }, forwardedRef) => {
    const innerRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLInputElement, []);

    React.useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = Boolean(indeterminate);
    }, [indeterminate]);

    return (
      <input
        ref={innerRef}
        type="checkbox"
        className={cn(
          'h-4 w-4 shrink-0 cursor-pointer accent-brand-primary',
          'focus-visible:outline-none focus-visible:shadow-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);
Checkbox.displayName = 'Checkbox';

// ─── Checkbox with its label ──────────────────────────────────────────────────

export interface CheckboxFieldProps extends CheckboxProps {
  /** The id wiring label to control. Required — a checkbox with no label is not a control. */
  id: string;
  label: React.ReactNode;
  /** Secondary line under the label, for the consequence of ticking it. */
  description?: React.ReactNode;
  /** Class for the row wrapper (label + description), not the input. */
  className?: string;
}

export function CheckboxField({ id, label, description, className, ...checkbox }: CheckboxFieldProps) {
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className={cn('min-w-0', className)}>
      {/* The description sits OUTSIDE the label on purpose. Nested inside, it becomes part of
          the control's accessible name, so a screen reader announces the checkbox as its label
          plus a sentence of explanation, and getByLabelText stops matching the label. Attached
          through aria-describedby it is announced after the name, which is what it is. */}
      <label
        htmlFor={id}
        className={cn(
          // min-h-control rather than a fixed height: the row is a touch target first — the
          // 44px floor the doctrine sets at 375px.
          'flex min-h-control items-center gap-2.5 py-2.5',
          checkbox.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        )}
      >
        <Checkbox id={id} aria-describedby={descriptionId} {...checkbox} />
        <span className="min-w-0 text-body-sm font-medium text-foreground">{label}</span>
      </label>
      {description ? (
        // Indented past the box so it reads as belonging to the label above it, and pulled up
        // to close the gap the label's own padding leaves.
        <p id={descriptionId} className="-mt-1.5 ps-6 text-caption leading-5 text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}

// ─── Radio group ──────────────────────────────────────────────────────────────

export interface RadioOption<TValue extends string> {
  value: TValue;
  label: React.ReactNode;
  /** Secondary line, for options whose difference is not obvious from the label. */
  description?: React.ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<TValue extends string> {
  /** Rendered as the fieldset's legend — the question the options answer. */
  label: React.ReactNode;
  /** Shared form-control name. Radios only behave as one group when they share it. */
  name: string;
  value: TValue | '';
  onChange: (value: TValue) => void;
  options: readonly RadioOption<TValue>[];
  description?: React.ReactNode;
  /**
   * `"horizontal"` (default) for a short closed set whose labels are a word or two — the
   * payment-terms case. `"vertical"` once options carry descriptions, or once there are more
   * than about four, at which point a horizontal row stops being scannable.
   *
   * With `variant="card"`, this instead decides whether the tiles sit in a wrapping row
   * (`"horizontal"`) or stack full-width, one per line (`"vertical"`).
   */
  orientation?: 'horizontal' | 'vertical';
  /**
   * `"inline"` (default) — a plain radio dot and label, one line.
   *
   * `"card"` — each option is a bordered, selectable tile with the radio, the label and its
   * description inside it, and the whole tile highlights on selection. Use this once an
   * option needs to be *chosen*, not just picked from a short list — a procurement method, a
   * tax treatment — where the description is part of deciding, not an afterthought.
   */
  variant?: 'inline' | 'card';
  disabled?: boolean;
  className?: string;
}

/**
 * A small, closed set of mutually exclusive choices, all visible at once.
 *
 * Prefer this over Select whenever the set is fixed and fits: a dropdown hides the options
 * behind an interaction and costs a click to answer a question the screen could simply have
 * asked. Past roughly five options, or when the set can grow, Select is the right control.
 */
export function RadioGroup<TValue extends string>({
  label,
  name,
  value,
  onChange,
  options,
  description,
  orientation = 'horizontal',
  variant = 'inline',
  disabled,
  className,
}: RadioGroupProps<TValue>) {
  const isCard = variant === 'card';

  return (
    <fieldset className={cn('min-w-0', className)} disabled={disabled}>
      <legend className="block text-body-sm font-medium text-foreground">{label}</legend>
      {description ? (
        <p className="mt-1 text-caption leading-5 text-muted-foreground">{description}</p>
      ) : null}

      <div
        className={cn(
          'mt-2 flex',
          orientation === 'horizontal'
            ? cn('flex-wrap', isCard ? 'items-stretch gap-3' : 'items-center gap-x-6 gap-y-1')
            : cn('flex-col', isCard ? 'gap-3' : 'gap-1'),
        )}
      >
        {options.map((option) => {
          const checked = value === option.value;
          const descriptionId = option.description ? `${name}-${option.value}-description` : undefined;

          if (isCard) {
            // The description sits OUTSIDE the <label htmlFor>, same rule as CheckboxField: a
            // screen reader names this radio from the label alone and reads the description
            // separately, from aria-describedby, once — not twice, and not run together into
            // one sentence a listener cannot tell apart from the label. The whole tile is still
            // clickable via the div's own onClick, so the description text is a live target too.
            const optionId = `${name}-${option.value}`;
            return (
              <div
                key={option.value}
                onClick={() => !option.disabled && onChange(option.value)}
                className={cn(
                  'flex min-w-0 flex-1 basis-56 items-start gap-2.5 rounded-panel border p-3.5 transition-colors',
                  'duration-(--motion-enter) ease-brand',
                  option.disabled
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer hover:border-border-interactive',
                  checked
                    ? 'border-brand-primary bg-surface-selected'
                    : 'border-border-strong bg-surface',
                )}
              >
                <input
                  type="radio"
                  id={optionId}
                  name={name}
                  value={option.value}
                  checked={checked}
                  disabled={option.disabled}
                  onChange={() => onChange(option.value)}
                  aria-describedby={descriptionId}
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand-primary',
                    'focus-visible:outline-none focus-visible:shadow-ring',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                />
                <span className="min-w-0">
                  <label
                    htmlFor={optionId}
                    className={cn(
                      'block text-body-sm font-semibold text-foreground',
                      option.disabled ? 'cursor-not-allowed' : 'cursor-pointer',
                    )}
                  >
                    {option.label}
                  </label>
                  {option.description ? (
                    <p
                      id={descriptionId}
                      className="mt-0.5 text-caption leading-5 text-muted-foreground"
                    >
                      {option.description}
                    </p>
                  ) : null}
                </span>
              </div>
            );
          }

          return (
            <div key={option.value} className="min-w-0">
              {/* Same rule as CheckboxField: the description is described-by, not named-by. */}
              <label
                className={cn(
                  'flex min-h-control items-center gap-2.5 py-2.5',
                  option.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={checked}
                  disabled={option.disabled}
                  onChange={() => onChange(option.value)}
                  aria-describedby={descriptionId}
                  className={cn(
                    'h-4 w-4 shrink-0 cursor-pointer accent-brand-primary',
                    'focus-visible:outline-none focus-visible:shadow-ring',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                />
                <span className="min-w-0 text-body-sm text-foreground">{option.label}</span>
              </label>
              {option.description ? (
                <p
                  id={descriptionId}
                  className="-mt-1.5 ps-6 text-caption leading-5 text-muted-foreground"
                >
                  {option.description}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
