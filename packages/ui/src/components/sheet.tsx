'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { cn } from '../lib/utils';

/**
 * Sheet (side panel) primitive, built on Radix Dialog.
 *
 * Shares Radix's focus management, scroll locking, aria-modal, and dismissal
 * safety with the Dialog component, but anchors to the right edge rather than
 * centring on screen. The underlying page content stays visible behind the
 * semi-transparent overlay — the design intent is that users keep their context
 * while acting on a lifecycle command.
 *
 * On narrow viewports (< sm) the sheet expands to full screen because a 420px
 * panel leaves no readable content behind on a 375px screen. Desktop keeps the
 * 420px side panel.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    {/* Lighter than the Dialog overlay so the record behind remains readable. */}
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-brand-ink/20" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 flex flex-col overflow-y-auto border-border bg-surface shadow-xl',
        // Mobile: full screen (no useful content is visible behind a 420px panel at 375px)
        'inset-0 border-0',
        // Desktop: right-anchored panel
        'sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[420px] sm:border-l',
        className,
      )}
      {...props}
    >
      {/* Close button — always in the top trailing corner */}
      <DialogPrimitive.Close
        className="absolute end-3 top-3 rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
        aria-label="Close"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </DialogPrimitive.Close>

      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';

export const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold text-foreground', className)}
    {...props}
  />
));
SheetTitle.displayName = 'SheetTitle';

export const SheetDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
SheetDescription.displayName = 'SheetDescription';

/** Sticky footer that stays at the bottom of the sheet regardless of scroll height. */
export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mt-auto flex flex-col gap-3 border-t border-border px-5 py-4',
        'sm:flex-row-reverse sm:justify-start',
        className,
      )}
      {...props}
    />
  );
}
