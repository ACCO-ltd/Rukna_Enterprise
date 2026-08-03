'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Textarea } from '@erp/ui';

interface ConfirmActionDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  /** When set, the user must supply a reason and it is passed to onConfirm. */
  requireReason?: boolean;
  reasonHint?: string;
  isPending: boolean;
  errorMessage?: string | undefined;
  onConfirm: (reason: string) => void;
  onDismiss: () => void;
}

const MAX_REASON_LENGTH = 1000;

/**
 * Confirmation step for lifecycle commands.
 *
 * Most of these transitions are irreversible — the API offers no way back from APPROVED to
 * DRAFT, and none at all from CANCELLED — so they should not fire on a single stray click.
 *
 * Focus moves into the dialog on open and returns to the trigger on close, Escape
 * dismisses, and the backdrop is inert to keyboard users. Written by hand rather than
 * pulled from a dependency, which keeps the promise made when we declined a toast library:
 * no new packages without justification.
 */
export function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  requireReason = false,
  reasonHint,
  isPending,
  errorMessage,
  onConfirm,
  onDismiss,
}: ConfirmActionDialogProps) {
  const t = useTranslations('platform.projects.actions');
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLTextAreaElement | HTMLButtonElement>(null);

  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    initialFocusRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPending) onDismiss();
      if (event.key !== 'Tab') return;

      // Minimal focus trap — keeps Tab inside the dialog while it is open.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, textarea, [href], input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [isPending, onDismiss]);

  const trimmedReason = reason.trim();
  const reasonError =
    touched && requireReason && !trimmedReason
      ? t('reasonRequired')
      : reason.length > MAX_REASON_LENGTH
        ? t('reasonTooLong')
        : undefined;

  const submit = () => {
    setTouched(true);
    if (requireReason && !trimmedReason) return;
    if (reason.length > MAX_REASON_LENGTH) return;
    onConfirm(trimmedReason);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="fixed inset-0 bg-brand-ink/40" aria-hidden="true" onClick={onDismiss} />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl sm:p-6"
      >
        <h2 id={titleId} className="text-lg font-semibold text-foreground">
          {title}
        </h2>
        <p id={descriptionId} className="mt-2 text-sm text-muted-foreground">
          {description}
        </p>

        {errorMessage ? (
          <div className="mt-4">
            <Alert variant="error" messages={[errorMessage]} />
          </div>
        ) : null}

        {requireReason ? (
          <div className="mt-4">
            <FormField htmlFor="action-reason" label={t('reasonLabel')} error={reasonError}>
              <Textarea
                id="action-reason"
                ref={initialFocusRef as React.RefObject<HTMLTextAreaElement>}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                }}
                onBlur={() => {
                  setTouched(true);
                }}
                aria-invalid={Boolean(reasonError)}
              />
              {reasonHint ? (
                <p className="text-xs text-muted-foreground">{reasonHint}</p>
              ) : null}
            </FormField>
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
          <Button
            ref={requireReason ? undefined : (initialFocusRef as React.RefObject<HTMLButtonElement>)}
            onClick={submit}
            disabled={isPending}
          >
            {isPending ? t('working') : confirmLabel}
          </Button>
          <Button variant="outline" onClick={onDismiss} disabled={isPending}>
            {t('dismiss')}
          </Button>
        </div>
      </div>
    </div>
  );
}
