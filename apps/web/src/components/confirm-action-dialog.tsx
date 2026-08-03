'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  FormField,
  Textarea,
} from '@erp/ui';

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
 * Focus management, scroll locking and dismissal come from `Dialog` in `@erp/ui`, which
 * replaced the focus trap this component used to carry. Two behaviours are specified here
 * because they are this dialog's own:
 *
 *  - **Nothing dismisses it while a request is in flight.** Escape, the overlay and the
 *    close gesture are all blocked by `isPending`. The previous implementation guarded
 *    Escape but not the overlay click, so a stray backdrop click could close a dialog
 *    mid-mutation and leave the user unsure whether the command had run.
 *  - **Focus opens on the reason field** when there is one, so a keyboard user can type
 *    immediately rather than tabbing past the heading.
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
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);

  const maxLength = reason?.maxLength ?? 1000;

  /** Blocks every dismissal path — Escape, overlay, and an outside click — while pending. */
  const preventWhilePending = (event: Event) => {
    if (isPending) event.preventDefault();
  };

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
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !isPending) onDismiss();
      }}
    >
      <DialogContent
        onEscapeKeyDown={preventWhilePending}
        onPointerDownOutside={preventWhilePending}
        onInteractOutside={preventWhilePending}
        onOpenAutoFocus={(event) => {
          if (!reason) return;
          // Radix focuses the first focusable node by default; for a dialog that asks for
          // a reason, that should be the field rather than the heading or a button.
          event.preventDefault();
          reasonRef.current?.focus();
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>

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
                ref={reasonRef}
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

        <DialogFooter>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? t('working') : confirmLabel}
          </Button>
          <Button variant="outline" onClick={onDismiss} disabled={isPending}>
            {t('dismiss')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
