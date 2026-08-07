'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  cn,
  FormField,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetTitle,
  Textarea,
} from '@erp/ui';

import { formatStatus, type StatusToken } from '@/lib/format';

// ─── Status chip ──────────────────────────────────────────────────────────────

const TOKEN_CLASSES: Record<StatusToken, string> = {
  NEUTRAL:     'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-blue-50  text-blue-700',
  WARNING:     'bg-amber-50 text-amber-700',
  SUCCESS:     'bg-green-50 text-green-700',
  DANGER:      'bg-red-50   text-red-700',
  HISTORICAL:  'bg-purple-50 text-purple-700',
};

function StatusChip({ status }: { status: string }) {
  const { token, muted } = formatStatus(status);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
        TOKEN_CLASSES[token],
        muted && 'opacity-60',
      )}
    >
      {/* Preserve the raw status key — the chip's text is a technical identifier
          for users who know the domain, not a translated label. */}
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

export interface LifecycleReasonField {
  /** When true the confirm button is disabled until text is entered. */
  required: boolean;
  label?: string;
  hint?: string;
  /** Mirrors the server's @MaxLength. Defaults to 1000. */
  maxLength?: number;
}

export interface LifecycleCommandDrawerProps {
  open: boolean;
  onClose: () => void;

  /** The command being performed, e.g. "Submit for Approval". */
  commandName: string;
  /** The aggregate's current status key, e.g. "DRAFT". */
  currentStatus: string;
  /** The status the aggregate will move to on success, e.g. "PENDING_INTERNAL_APPROVAL". */
  nextStatus: string;

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
 * Wraps a Sheet (right-anchored panel) with the command header, status transition
 * indicator, optional business impact copy, a customisable form area, and a
 * sticky footer. Callers bring their own lifecycle hook (`useLifecycleCommand`)
 * and pass `isPending`, `errorMessage`, and `onConfirm` down to this shell.
 *
 * Nothing dismisses the drawer while a request is in flight.
 *
 * @example
 * const submit = useIpaCommand(ipa.id);
 *
 * <LifecycleCommandDrawer
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
export function LifecycleCommandDrawer({
  open,
  onClose,
  commandName,
  currentStatus,
  nextStatus,
  businessImpact,
  reason,
  children,
  confirmLabel,
  isDestructive = false,
  isPending,
  errorMessage,
  onConfirm,
}: LifecycleCommandDrawerProps) {
  const t = useTranslations('common.confirmDialog');
  const reasonRef = useRef<HTMLTextAreaElement>(null);

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

  /** Blocks every dismissal path (Escape, overlay, outside click) while pending. */
  const preventWhilePending = (event: { preventDefault: () => void }) => {
    if (isPending) event.preventDefault();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !isPending) {
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
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        onEscapeKeyDown={preventWhilePending}
        onPointerDownOutside={preventWhilePending}
        onInteractOutside={preventWhilePending}
        onOpenAutoFocus={(event: Event) => {
          if (!reason) return;
          // Focus the reason textarea immediately so keyboard users can type without tabbing.
          event.preventDefault();
          reasonRef.current?.focus();
        }}
      >
        {/* Header */}
        <div className="px-5 pb-4 pt-10">
          <SheetTitle>{commandName}</SheetTitle>

          {/* Status transition indicator */}
          <div className="mt-3 flex items-center gap-2 text-sm">
            <StatusChip status={currentStatus} />
            <span className="text-muted-foreground" aria-hidden="true">→</span>
            <StatusChip status={nextStatus} />
          </div>

          {/* Business impact */}
          {businessImpact ? (
            <SheetDescription className="mt-4">{businessImpact}</SheetDescription>
          ) : null}
        </div>

        {/* Divider */}
        <div className="border-t border-border" />

        {/* Form area */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
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
                ref={reasonRef}
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
        </div>

        {/* Sticky footer */}
        <SheetFooter>
          <Button
            variant={isDestructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? t('working') : confirmLabel}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {t('dismiss')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
