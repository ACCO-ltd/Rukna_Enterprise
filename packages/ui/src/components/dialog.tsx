'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { cn } from '../lib/utils';

/**
 * Modal dialog, built on Radix.
 *
 * ─── Why a dependency here ───────────────────────────────────────────────────────
 *
 * This app had a hand-written focus trap, and it was a reasonable thing to write: no new
 * package, full control, and it worked for the case it was built for. But it also has to
 * be right for every case, and a trap written by hand has to keep getting the details
 * right as screens accumulate:
 *
 *  - Skipping DISABLED elements when cycling. A dialog that disables its buttons while a
 *    mutation is in flight — which every confirmation here does — has a Tab cycle that
 *    lands on nothing.
 *  - Hiding the page behind it from assistive technology. Without `aria-hidden` management
 *    a screen reader walks straight out of the dialog into the page it is covering.
 *  - Guarding EVERY dismissal path consistently. The previous implementation guarded
 *    Escape with `isPending` but not the overlay click, so a stray backdrop click could
 *    close a dialog mid-request.
 *  - Restoring focus to the trigger, pointer-event containment, scroll locking that
 *    survives nesting.
 *
 * Radix handles all of it and is tested against screen readers directly. The platform is
 * also bilingual with RTL, where focus order and dismissal gestures are easy to get subtly
 * wrong by hand. That is what justifies the package.
 *
 * The visual treatment is unchanged — same tokens, same radii, same bottom-sheet-on-mobile
 * behaviour as the dialog it replaces.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Accessible name for the close control. */
    closeLabel?: string;
  }
>(({ className, children, closeLabel = 'Close', ...props }, ref) => (
  <DialogPrimitive.Portal>
    {/* Blurred as well as dimmed. A flat scrim separates the dialog from the page; blurring
        what is behind it also stops a dense table competing for attention through the tint. */}
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-sm" />
    <DialogPrimitive.Content
      ref={ref}
      // Anchored to the bottom on narrow screens and centred from `sm` up: a sheet within
      // thumb reach beats a box in the middle of a phone. `max-h` with an internal scroll
      // keeps a long dialog usable at 375px rather than pushing its buttons off-screen.
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto border border-border bg-surface-elevated p-6 shadow-e3',
        'rounded-t-container sm:rounded-container',
        'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:p-8',
        className,
      )}
      {...props}
    >
      {children}

      {/* Routed through onOpenChange like every other dismissal, so a dialog that blocks
          closing while a request is in flight blocks this too, without knowing it exists. */}
      <DialogPrimitive.Close
        aria-label={closeLabel}
        className="absolute end-4 top-4 flex h-8 w-8 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:shadow-ring"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('pe-8 text-h2 font-semibold text-foreground', className)}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('mt-2 text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';

/**
 * Action row. Reversed on wide screens so the primary action sits on the trailing edge,
 * stacked on narrow ones with the primary on top.
 *
 * `flex-row-reverse` follows the writing direction rather than fighting it, so the primary
 * action lands on the right in English and on the left in Arabic without a second rule.
 */
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mt-6 flex flex-col gap-3 sm:flex-row-reverse sm:justify-start',
        className,
      )}
      {...props}
    />
  );
}
