'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '../lib/utils';
import { useDialogDismissGuard } from '../lib/use-dialog-dismiss-guard';
import { ConfirmDialog } from './confirm-dialog';
import { useReturnFocus } from './dialog';

/**
 * The dialog for creating or editing one record, and for previews and history (ADR-039).
 *
 * ─── Anatomy ─────────────────────────────────────────────────────────────────────
 *
 *   ┌ header ─────────────────────────────── ✕ ┐  fixed: title, optional subtitle, close
 *   │ body                                      │  scrolls on its own (FormDialogBody)
 *   └ footer ──────────────── Cancel · Save ────┘  fixed: actions end-aligned, primary last
 *
 * The dialog sizes to its content up to ~90dvh; past that only the body scrolls, so the title
 * and the Save button never leave the screen. Below `sm` it is full screen (ADR-039: "mobile
 * dialogs are full screen") with the same fixed header and footer.
 *
 * ─── Dismissal ───────────────────────────────────────────────────────────────────
 *
 * Every way out — Escape, the overlay, the ✕, a `FormDialogClose` Cancel — goes through one
 * guard (`useDialogDismissGuard`):
 *  - `busy`: ignored outright while a save is in flight.
 *  - `dirty`: held, and "Discard unsaved changes?" is asked first.
 * A caller that closes the dialog itself after a successful save (by setting `open` to false)
 * is not asked anything: that is not a dismissal, it is the end of the task.
 *
 * ─── Why not `DialogContent` ─────────────────────────────────────────────────────
 *
 * `DialogContent` is a padded box that scrolls as a whole and sits at the bottom on phones — the
 * right shape for a confirmation. A record form needs the opposite: a pinned header and footer
 * around a scrolling body, and the whole screen on a phone. Both are built on the same Radix
 * primitive and share its focus trap, `aria-hidden` management and focus return.
 */

/**
 * Width tier on `sm+`, each capped at `100vw - 2rem` so a narrow laptop never scrolls sideways.
 *
 *  md   560px  1–6 fields
 *  lg   720px  a record form
 *  xl   960px  a record with a short list
 *  2xl 1200px  comparisons
 */
const formDialogSizeClass = {
  md: 'sm:max-w-[560px]',
  lg: 'sm:max-w-[720px]',
  xl: 'sm:max-w-[960px]',
  '2xl': 'sm:max-w-[1200px]',
} as const;

export type FormDialogSize = keyof typeof formDialogSizeClass;

/**
 * What counts as "the first field" for initial focus. `[data-autofocus]` wins when present, so a
 * form whose first control is not the one to start on can say so.
 */
const FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[role="combobox"]:not([aria-disabled="true"])',
  '[role="radio"][tabindex="0"]',
  '[contenteditable="true"]',
].join(', ');

export interface FormDialogProps {
  open: boolean;
  /** Called with `false` once a dismissal is allowed through the busy/dirty guard. */
  onOpenChange: (open: boolean) => void;
  /** Names the dialog (`aria-labelledby`). Sentence case: "Edit item", "Item 2.1". */
  title: React.ReactNode;
  /** One line under the title, and the dialog's `aria-describedby`: "Measurement and pricing". */
  subtitle?: React.ReactNode;
  /** Width tier on `sm+`. Defaults to `md` (560px). */
  size?: FormDialogSize;
  /** Unsaved edits: a dismissal asks "Discard unsaved changes?" first. */
  dirty?: boolean;
  /** A save is in flight: every dismissal is blocked and the close button is disabled. */
  busy?: boolean;
  /**
   * Where focus lands on open. `'first-field'` (default): the `[data-autofocus]` element, else the
   * first field in the body, else the dialog itself — never a footer button, so Enter cannot
   * confirm something the user has not read. `'dialog'`: the dialog itself, for previews.
   */
  initialFocus?: 'first-field' | 'dialog';
  /**
   * When set, the body and footer are wrapped in a `<form>` (without breaking the scrolling
   * layout), so a `type="submit"` button in the footer submits it and Enter in a field does too.
   * The native submit is already prevented and does not propagate to an enclosing page form.
   */
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
  /** Accessible name for the ✕. */
  closeLabel?: string;
  /** Copy for the discard confirmation. English defaults; pass translations where needed. */
  discardLabels?: {
    title?: string;
    description?: string;
    confirm?: string;
    cancel?: string;
  };
  className?: string;
  children: React.ReactNode;
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  size = 'md',
  dirty = false,
  busy = false,
  initialFocus = 'first-field',
  onSubmit,
  closeLabel = 'Close',
  discardLabels,
  className,
  children,
}: FormDialogProps) {
  const contentRef = React.useRef<HTMLDivElement>(null);
  const dismiss = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const guard = useDialogDismissGuard(busy, dismiss, { dirty, open });

  const returnFocus = useReturnFocus((event) => {
    // Take focus placement over from Radix, whose default is "first tabbable" — which, with the
    // ✕ in the header, would be the close button.
    event.preventDefault();
    const content = contentRef.current;
    if (!content) return;
    const body = content.querySelector<HTMLElement>('[data-form-dialog-body]');
    const target =
      initialFocus === 'first-field'
        ? (content.querySelector<HTMLElement>('[data-autofocus]') ??
          body?.querySelector<HTMLElement>(FIELD_SELECTOR) ??
          null)
        : null;
    (target ?? content).focus();
  });

  const inner = onSubmit ? (
    <form
      noValidate
      onSubmit={(event) => {
        // React bubbles synthetic events through portals, so without this a FormDialog opened
        // from inside a page-level <form> would submit that page form as well.
        event.preventDefault();
        event.stopPropagation();
        onSubmit(event);
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      {children}
    </form>
  ) : (
    children
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={guard.onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-sm motion-safe:animate-enter-fade" />
        <DialogPrimitive.Content
          ref={contentRef}
          data-size={size}
          aria-busy={busy || undefined}
          // Radix wires aria-describedby to the Description when there is one; with no subtitle
          // it must be cleared explicitly or Radix warns about a missing description.
          {...(subtitle ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden bg-surface-elevated shadow-e3 outline-none',
            'motion-safe:animate-enter-fade',
            // Phones: the whole screen, header and footer still pinned.
            'inset-0 h-dvh w-dvw',
            // sm+: centred, sized to content up to ~90dvh.
            'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100vw-2rem)]',
            'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-container sm:border sm:border-border',
            formDialogSizeClass[size],
            className,
          )}
          onEscapeKeyDown={guard.contentProps.onEscapeKeyDown}
          onPointerDownOutside={guard.contentProps.onPointerDownOutside}
          onInteractOutside={guard.contentProps.onInteractOutside}
          onOpenAutoFocus={returnFocus.onOpenAutoFocus}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        >
          <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pt-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-h2 font-semibold text-foreground">
                {title}
              </DialogPrimitive.Title>
              {subtitle ? (
                <DialogPrimitive.Description className="mt-0.5 text-body-sm text-muted-foreground">
                  {subtitle}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            {/* Routed through onOpenChange like every other dismissal, so the guard covers it. */}
            <DialogPrimitive.Close
              aria-label={closeLabel}
              disabled={busy}
              className={cn(
                '-me-2 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors',
                'hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:shadow-ring',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              <X className="size-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          {inner}

          {open ? (
            <ConfirmDialog
              open={guard.discard.open}
              onOpenChange={(next) => {
                if (!next) guard.discard.cancel();
              }}
              title={discardLabels?.title ?? 'Discard unsaved changes?'}
              description={discardLabels?.description ?? 'Your changes in this form will be lost.'}
              confirmLabel={discardLabels?.confirm ?? 'Discard changes'}
              cancelLabel={discardLabels?.cancel ?? 'Keep editing'}
              initialFocus="cancel"
              onConfirm={guard.discard.confirm}
            />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The scrolling region between the pinned header and footer. */
export function FormDialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-form-dialog-body=""
      className={cn('min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6', className)}
      {...props}
    />
  );
}

export interface FormDialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * A secondary action held apart on the start edge — "Delete item" — so it is never read as
   * one of the pair that finishes the task.
   */
  start?: React.ReactNode;
}

/**
 * The pinned action row. Actions are end-aligned with the primary LAST in source order, so it
 * lands on the trailing edge (right in English, left in Arabic). On phones they stack, the
 * primary on top, within thumb reach.
 */
export function FormDialogFooter({ className, start, children, ...props }: FormDialogFooterProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col-reverse gap-3 border-t border-border bg-surface-elevated px-4 pt-4',
        'pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-end sm:px-6 sm:pb-4',
        className,
      )}
      {...props}
    >
      {start ? <div className="flex gap-3 sm:me-auto">{start}</div> : null}
      {children}
    </div>
  );
}

/**
 * Closes the dialog through its guard — use it for the footer's Cancel so a dirty form asks
 * before discarding. A Cancel that calls `onOpenChange(false)` directly would skip the question.
 */
export const FormDialogClose = DialogPrimitive.Close;

export interface FormDialogSectionProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
}

/**
 * A titled group of fields, for a long form. Sections after the first are divided by a hairline.
 */
export function FormDialogSection({
  title,
  description,
  className,
  children,
  ...props
}: FormDialogSectionProps) {
  const headingId = React.useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn('border-t border-border pt-6 first:border-t-0 first:pt-0', className)}
      {...props}
    >
      <div className="mb-4">
        <h3 id={headingId} className="text-h3 font-semibold text-foreground">
          {title}
        </h3>
        {description ? (
          <p className="mt-1 text-caption leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
