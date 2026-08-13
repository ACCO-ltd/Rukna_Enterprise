'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';
import { Warning } from '@phosphor-icons/react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FormFieldError {
  /** Human-readable field label (e.g. "Project code"). */
  label: string;
  /** The HTML `id` of the field to jump to on click. */
  fieldId: string;
  /** The error message. */
  message: string;
}

export interface FormErrorSummaryProps {
  /**
   * Field-level errors. Each item renders as a focusable link that jumps to
   * and focuses the named control.
   */
  errors: FormFieldError[];
  /**
   * Non-field errors (API or form-level). Rendered separately at the top so
   * they are not lost if field-level errors are also present.
   */
  formErrors?: string[];
  /** Override the default heading "Please fix the following". */
  title?: string;
  className?: string;
}

/**
 * Renders a summarised list of form validation failures above the form body.
 *
 * Each field-level error links to its control via a smooth-scroll focus —
 * keyboard users don't have to tab through the whole form to find what's wrong.
 * The container uses `role="alert"` so screen readers announce the summary
 * immediately after a failed submission.
 *
 * API errors that don't map to a specific field appear as `formErrors` above
 * the field list. Use `formErrors` for server messages like "duplicate code"
 * that don't belong to a single input.
 *
 * @example
 * <FormErrorSummary
 *   errors={[
 *     { label: t('codeLabel'), fieldId: 'code', message: errors.code.message },
 *   ]}
 *   formErrors={serverError ? [serverError] : []}
 * />
 */
export function FormErrorSummary({
  errors,
  formErrors,
  title,
  className,
}: FormErrorSummaryProps) {
  const t = useTranslations('common.formErrors');

  const hasErrors = errors.length > 0 || (formErrors && formErrors.length > 0);
  if (!hasErrors) return null;

  const handleFieldLink = (fieldId: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById(fieldId);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus();
    }
  };

  return (
    <div
      role="alert"
      className={cn(
        'rounded-lg border border-danger/30 bg-danger-subtle px-4 py-4',
        className,
      )}
    >
      <div className="flex gap-3">
        <span className="mt-0.5 shrink-0 text-danger">
          <Warning size={18} weight="bold" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-danger">
            {title ?? t('title')}
          </p>

          {formErrors && formErrors.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {formErrors.map((msg, i) => (
                <li key={i} className="text-sm text-danger">
                  {msg}
                </li>
              ))}
            </ul>
          ) : null}

          {errors.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {errors.map(({ label, fieldId, message }) => (
                <li key={fieldId}>
                  <a
                    href={`#${fieldId}`}
                    onClick={handleFieldLink(fieldId)}
                    className="text-sm text-danger underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
                  >
                    <span className="font-medium">{label}:</span> {message}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
