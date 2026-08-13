'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, cn } from '@erp/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FormActionsProps {
  /** Text on the primary submit button. */
  submitLabel: string;
  /** Text while `isPending` is true. Defaults to common.formActions.pendingLabel. */
  pendingLabel?: string;
  /** When true the submit button shows the pending state and is disabled. */
  isPending: boolean;
  /** Render the cancel button as a link to this path. Prefer this over `onCancel`. */
  cancelHref?: string;
  /** Cancel click handler (used when the cancel action requires logic). */
  onCancel?: () => void;
  /** Cancel button label. Defaults to common.cancel. */
  cancelLabel?: string;
  /** Optional tertiary action rendered to the start of the bar (LTR left). */
  tertiary?: React.ReactNode;
  /** Make the bar sticky to the bottom of the viewport. Default: true. */
  sticky?: boolean;
  className?: string;
}

/**
 * Shared form action bar for create and edit forms.
 *
 * Sits at the bottom of a long form with a distinct top border. On desktop the
 * primary action is on the right (LTR) / left (RTL); on mobile the buttons
 * stack vertically. When `sticky` is true (the default) the bar stays in view
 * while the user scrolls through a long form — the form container must have
 * enough `pb-*` to avoid the last field being hidden behind it.
 *
 * @example
 * <FormActions
 *   submitLabel={t('submit')}
 *   isPending={mutation.isPending}
 *   cancelHref="/projects"
 * />
 */
export function FormActions({
  submitLabel,
  pendingLabel,
  isPending,
  cancelHref,
  onCancel,
  cancelLabel,
  tertiary,
  sticky = true,
  className,
}: FormActionsProps) {
  const t = useTranslations('common');

  const resolvedPending = pendingLabel ?? t('formActions.pendingLabel');
  const resolvedCancel = cancelLabel ?? t('cancel');

  return (
    <div
      className={cn(
        'border-t border-border bg-surface/95 px-5 py-4 backdrop-blur-sm sm:px-6',
        sticky && 'sticky bottom-0 z-20',
        className,
      )}
    >
      <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        {/* Tertiary action — start of bar */}
        <div className="flex shrink-0">{tertiary ?? null}</div>

        {/* Primary and cancel — end of bar */}
        <div className="flex flex-col gap-2.5 sm:flex-row-reverse sm:items-center">
          <Button type="submit" disabled={isPending}>
            {isPending ? resolvedPending : submitLabel}
          </Button>

          {cancelHref ? (
            <Button variant="outline" asChild disabled={isPending}>
              <Link href={cancelHref}>{resolvedCancel}</Link>
            </Button>
          ) : onCancel ? (
            <Button variant="outline" type="button" onClick={onCancel} disabled={isPending}>
              {resolvedCancel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
