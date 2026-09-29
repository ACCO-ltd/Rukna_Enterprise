'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormField,
  Textarea,
} from '@erp/ui';

import { StatusBadge } from '@/components/status-badge';
import type { StatusVocabulary } from '@/lib/status-registry';

// ─── Dialog ───────────────────────────────────────────────────────────────────

export interface LifecycleReasonField {
  /** When true the confirm button is disabled until text is entered. */
  required: boolean;
  label?: string;
  hint?: string;
  /** Mirrors the server's @MaxLength. Defaults to 1000. */
  maxLength?: number;
}

export interface LifecycleCommandDialogProps {
  open: boolean;
  onClose: () => void;

  /** The command being performed, e.g. "Submit for Approval". */
  commandName: string;
  /** The aggregate's current status key, e.g. "DRAFT". */
  currentStatus: string;
  /** The status the aggregate will move to on success, e.g. "PENDING_INTERNAL_APPROVAL". */
  nextStatus: string;
  /** Which lifecycle the two statuses belong to, so they are toned by the status registry. */
  statusVocabulary?: StatusVocabulary;

  /**
   * One or two sentences describing the business consequence of this command.
   * Shown before the form fields so the user understands the impact before typing.
   */
  businessImpact?: string;

  /** When provided, renders a reason textarea above any children. */
  reason?: LifecycleReasonField;

  /**
   * Slot for command-specific fields (e.g. exchange rate, notes, rejection text).
   * Rendered between the business impact text and the reason field.
   */
  children?: React.ReactNode;

  /** Label for the confirm button. Usually the command verb, e.g. "Submit". */
  confirmLabel: string;
  /**
   * When true the confirm button renders in the destructive (red) style.
   * Use for irreversible negative actions: Cancel Project, Terminate Contract.
   */
  isDestructive?: boolean;

  isPending: boolean;
  /** Server error to show in the error alert. */
  errorMessage?: string;
  /** Called with the trimmed reason text (empty string when `reason` is not set). */
  onConfirm: (reason: string) => void;
}

/**
 * The standard shell for every lifecycle transition in the platform.
 *
 * A `FormDialog` (ADR-039, size `md`): the command as the title, the status transition and
 * the business impact at the top of the scrolling body, a customisable form area, and the
 * pinned footer. Callers bring their own lifecycle hook (`useLifecycleCommand`)
 * and pass `isPending`, `errorMessage`, and `onConfirm` down to this shell.
 *
 * Nothing dismisses the dialog while a request is in flight (`busy`), and a typed reason is not
 * thrown away without asking (`dirty`).
 *
 * @example
 * const submit = useIpaCommand(ipa.id);
 *
 * <LifecycleCommandDialog
 *   open={open}
 *   onClose={() => { submit.reset(); setOpen(false); }}
 *   commandName="Submit for Approval"
 *   currentStatus={ipa.status}
 *   nextStatus="PENDING_INTERNAL_APPROVAL"
 *   businessImpact="Once submitted, the application is locked for editing."
 *   confirmLabel="Submit"
 *   isPending={submit.isPending}
 *   errorMessage={submit.failure?.serverMessage}
 *   onConfirm={() => submit.mutate('submit', { onSuccess: () => setOpen(false) })}
 * />
 */
export function LifecycleCommandDialog({
  open,
  onClose,
  commandName,
  currentStatus,
  nextStatus,
  statusVocabulary,
  businessImpact,
  reason,
  children,
  confirmLabel,
  isDestructive = false,
  isPending,
  errorMessage,
  onConfirm,
}: LifecycleCommandDialogProps) {
  const t = useTranslations('common.confirmDialog');
  const tDiscard = useTranslations('common.discardChanges');

  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);

  const maxLength = reason?.maxLength ?? 1000;
  const trimmed = text.trim();

  const reasonError =
    touched && reason?.required && !trimmed
      ? t('reasonRequired')
      : text.length > maxLength
        ? t('reasonTooLong', { max: maxLength })
        : undefined;

  const handleOpenChange = (next: boolean) => {
    // FormDialog's guard has already refused this while pending, and asked about a typed reason.
    if (!next) {
      // Reset local form state on close so a re-open starts fresh.
      setText('');
      setTouched(false);
      onClose();
    }
  };

  const handleConfirm = () => {
    setTouched(true);
    if (reason?.required && !trimmed) return;
    if (text.length > maxLength) return;
    onConfirm(trimmed);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={commandName}
      size="md"
      busy={isPending}
      dirty={trimmed.length > 0}
      discardLabels={{
        title: tDiscard('title'),
        description: tDiscard('description'),
        confirm: tDiscard('confirm'),
        cancel: tDiscard('cancel'),
      }}
    >
      <FormDialogBody>
        {/* Status transition indicator */}
        <div className="flex items-center gap-2 text-sm">
          <StatusBadge status={currentStatus} vocabulary={statusVocabulary} />
          <span className="text-muted-foreground" aria-hidden="true">→</span>
          <StatusBadge status={nextStatus} vocabulary={statusVocabulary} />
        </div>

        {/* Business impact, before any field, so the consequence is read before typing. */}
        {businessImpact ? <p className="text-body-sm text-muted-foreground">{businessImpact}</p> : null}

        {errorMessage ? <Alert variant="error" messages={[errorMessage]} /> : null}

        {/* Custom command-specific fields (notes, exchange rate, etc.) */}
        {children}

        {reason ? (
          <FormField
            htmlFor="lifecycle-reason"
            label={reason.label ?? t('reasonLabel')}
            error={reasonError}
          >
            <Textarea
              id="lifecycle-reason"
              // Focus lands here on open, so a keyboard user types the reason without tabbing.
              data-autofocus=""
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={Boolean(reasonError)}
              disabled={isPending}
            />
            {reason.hint ? (
              <p className="text-xs text-muted-foreground">{reason.hint}</p>
            ) : null}
          </FormField>
        ) : null}
      </FormDialogBody>

      <FormDialogFooter>
        <FormDialogClose asChild>
          <Button type="button" variant="outline" disabled={isPending}>
            {t('dismiss')}
          </Button>
        </FormDialogClose>
        <Button
          variant={isDestructive ? 'destructive' : 'default'}
          onClick={handleConfirm}
          disabled={isPending}
        >
          {isPending ? t('working') : confirmLabel}
        </Button>
      </FormDialogFooter>
    </FormDialog>
  );
}
