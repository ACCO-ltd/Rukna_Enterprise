'use client';

import * as React from 'react';

import { cn } from '../lib/utils';
import { Label } from './label';

// ─── Context ──────────────────────────────────────────────────────────────────

export interface FormFieldContextValue {
  /** The id of the associated control (htmlFor). */
  controlId: string;
  /** id of the rendered hint element, when a hint prop is provided. */
  hintId: string | undefined;
  /** id of the rendered error element, when an error is present. */
  errorId: string | undefined;
  /** id of the rendered success element, when a success message is present. */
  successId: string | undefined;
  /** True when an error message is present. */
  hasError: boolean;
  /** True when a success message is present and no error is. */
  hasSuccess: boolean;
  /** True while an async check on this field is in flight. */
  isChecking: boolean;
  /** True when the required indicator is shown. */
  required: boolean;
}

export const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

/** Consume the nearest FormField's computed IDs and error state. */
export function useFormField(): FormFieldContextValue | null {
  return React.useContext(FormFieldContext);
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface FormFieldProps {
  htmlFor: string;
  label: React.ReactNode;
  /**
   * Hint text rendered below the control with `id="{htmlFor}-hint"`.
   * Consumed automatically by Input, Select, and Textarea siblings via
   * FormFieldContext — no manual `aria-describedby` needed.
   */
  hint?: React.ReactNode;
  /** Inline field-level error. Shows below hint with `role="alert"`. */
  error?: string | undefined;
  /**
   * Confirmation that a value was checked and is good — "Verified, matches registered
   * supplier", not "Valid".
   *
   * Only worth showing where the check told the user something they could not have known
   * themselves: a lookup succeeded, a code resolved, a figure reconciled. A tick on every
   * field that merely passed a required-check is noise, and it devalues the tick on the
   * field where it means something.
   *
   * `error` wins when both are set — a field cannot be both, and showing the failure is
   * never the wrong choice.
   */
  success?: string | undefined;
  /**
   * True while an async check is in flight. Renders a status line and puts the control in
   * its checking state, so the user knows the blank verdict is pending rather than absent.
   */
  checking?: boolean;
  /** Message shown while `checking`. Defaults to nothing but the animated indicator. */
  checkingLabel?: string;
  /**
   * Live character count, e.g. `{ value: 42, max: 500 }`.
   *
   * Rendered on the hint line rather than below it, because a counter is a property of the
   * field's constraints and stacking it as a third line pushes every subsequent field down.
   * Turns danger-toned once the limit is passed.
   */
  counter?: { value: number; max: number };
  /**
   * When true renders an asterisk (*) beside the label and sets `aria-required`
   * on associated controls through context.
   */
  required?: boolean;
  /**
   * Text beside the label for a field whose requirement is conditional — the
   * "optional until certified ≠ claimed" case, where neither a plain asterisk nor its
   * absence is true.
   */
  requirementNote?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function FormField({
  htmlFor,
  label,
  hint,
  error,
  success,
  checking,
  checkingLabel,
  counter,
  required,
  requirementNote,
  children,
  className,
}: FormFieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  // A field is never both. Error wins, so a stale success can never mask a live failure.
  const showSuccess = Boolean(success) && !error;
  const successId = showSuccess ? `${htmlFor}-success` : undefined;

  const ctx: FormFieldContextValue = {
    controlId: htmlFor,
    hintId,
    errorId,
    successId,
    hasError: Boolean(error),
    hasSuccess: showSuccess,
    isChecking: Boolean(checking),
    required: Boolean(required),
  };

  const overLimit = counter ? counter.value > counter.max : false;

  return (
    <FormFieldContext.Provider value={ctx}>
      <div className={cn('space-y-1.5', className)}>
        <Label htmlFor={htmlFor}>
          {label}
          {required ? (
            <span className="ms-0.5 text-danger" aria-hidden="true">
              *
            </span>
          ) : null}
          {requirementNote ? (
            <span className="ms-1.5 font-normal text-muted-foreground">{requirementNote}</span>
          ) : null}
        </Label>
        {children}

        {/* Hint and counter share one line: a counter is a property of the field's
            constraints, and giving it a line of its own pushes every later field down. */}
        {hint || counter ? (
          <div className="flex items-start justify-between gap-3">
            {hint ? (
              <p id={hintId} className="text-caption leading-5 text-muted-foreground">
                {hint}
              </p>
            ) : (
              <span />
            )}
            {counter ? (
              <span
                className={cn(
                  'shrink-0 text-caption leading-5 tabular-nums',
                  overLimit ? 'font-semibold text-danger' : 'text-muted-foreground',
                )}
              >
                {counter.value} / {counter.max}
              </span>
            ) : null}
          </div>
        ) : null}

        {checking ? (
          <p className="flex items-center gap-1.5 text-caption leading-5 text-muted-foreground" role="status">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-brand-primary"
            />
            {checkingLabel}
          </p>
        ) : null}

        {error ? (
          <p
            id={errorId}
            className="flex items-start gap-1.5 text-caption font-medium leading-5 text-danger"
            role="alert"
          >
            <WarningGlyph />
            {error}
          </p>
        ) : null}

        {showSuccess ? (
          // Polite, not assertive: a confirmation must never interrupt what someone is
          // reading, and unlike an error it costs nothing to hear a moment later.
          <p
            id={successId}
            className="flex items-start gap-1.5 text-caption font-medium leading-5 text-success"
            role="status"
          >
            <CheckGlyph />
            {success}
          </p>
        ) : null}
      </div>
    </FormFieldContext.Provider>
  );
}

// ─── Glyphs ───────────────────────────────────────────────────────────────────
// Inline rather than from the icon package: packages/ui carries no icon dependency, and
// these two are the only ones its own components need. Colour alone never carries the
// verdict — the glyph is what survives a monochrome print and a colour-blind reader.

function WarningGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
    >
      <circle cx="6" cy="6" r="5.1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 3.4v2.9M6 8.3v.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
    >
      <path
        d="M2 6.4l2.6 2.6L10 3.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
