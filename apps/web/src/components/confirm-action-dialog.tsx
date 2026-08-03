'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, FormField, Textarea } from '@erp/ui';

export interface ConfirmReasonField {
  /** When true the action is blocked until text is supplied. */
  required: boolean;
  /** Defaults to the generic "Reason" label. */
  label?: string;
  hint?: string;
  /** Mirrors the server's @MaxLength. Defaults to 1000, which is what the DTOs use. */
  maxLength?: number;
}

interface ConfirmActionDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  /** Omit for a plain yes/no confirmation. */
  reason?: ConfirmReasonField;
  isPending: boolean;
  errorMessage?: string | undefined;
  onConfirm: (text: string) => void;
  onDismiss: () => void;
}

/**
 * Confirmation step for irreversible actions.
 *
 * Most of the commands behind this dialog cannot be undone — a project cannot go back from
 * APPROVED to DRAFT, a cancelled draft cannot be recovered — so they should not fire on a
 * stray click.
 *
 * Focus moves in on open and returns to the trigger on close, Escape dismisses, and Tab is
 * trapped inside. Written by hand rather than pulled from a dependency, which keeps the
 * promise made when a toast library was declined: no new packages without justification.
 */
export function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  reason,
  isPending,
  errorMessage,
  onConfirm,
  onDismiss,
}: ConfirmActionDialogProps) {
  const t = useTranslations('common.confirmDialog');
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLTextAreaElement | HTMLButtonElement>(null);

  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);

  const maxLength = reason?.maxLength ?? 1000;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    initialFocusRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPending) onDismiss();
      if (event.key !== 'Tab') return;

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

  const trimmed = text.trim();
  const textError =
    touched && reason?.required && !trimmed
      ? t('reasonRequired')
      : text.length > maxLength
        ? t('reasonTooLong', { max: maxLength })
        : undefined;

  const submit = () => {
    setTouched(true);
    if (reason?.required && !trimmed) return;
    if (text.length > maxLength) return;
    onConfirm(trimmed);
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

        {reason ? (
          <div className="mt-4">
            <FormField
              htmlFor="confirm-reason"
              label={reason.label ?? t('reasonLabel')}
              error={textError}
            >
              <Textarea
                id="confirm-reason"
                ref={initialFocusRef as React.RefObject<HTMLTextAreaElement>}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                }}
                onBlur={() => {
                  setTouched(true);
                }}
                aria-invalid={Boolean(textError)}
              />
              {reason.hint ? <p className="text-xs text-muted-foreground">{reason.hint}</p> : null}
            </FormField>
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
          <Button
            ref={reason ? undefined : (initialFocusRef as React.RefObject<HTMLButtonElement>)}
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
