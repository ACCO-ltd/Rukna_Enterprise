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
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
    <DialogPrimitive.Content
      ref={ref}
      // Anchored to the bottom on narrow screens and centred from `sm` up: a sheet within
      // thumb reach beats a box in the middle of a phone. `max-h` with an internal scroll
      // keeps a long dialog usable at 375px rather than pushing its buttons off-screen.
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto border border-border bg-surface-elevated p-5 shadow-[var(--shadow-overlay)]',
        'rounded-t-lg sm:rounded-lg',
        'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:p-6',
        className,
      )}
      {...props}
    >
      {children}
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
    className={cn('text-lg font-semibold text-foreground', className)}
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
