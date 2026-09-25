'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

import { cn } from '../lib/utils';

/**
 * A full-height panel anchored to the start or end edge, for reviewing a record alongside
 * a list rather than as a blocking step. Built on the same `@radix-ui/react-dialog` primitive
 * as `Dialog` — see dialog.tsx for why that dependency earns its place (focus trap, `aria-hidden`
 * management on the page behind it, every dismissal path guarded consistently, RTL-safe focus
 * order). `Sheet` only changes the content's position and size, not its accessibility model.
 *
 * ─── Reach for `Dialog` first ─────────────────────────────────────────────────────
 *
 * This is not a drop-in replacement for every screen with "drawer" or "panel" in its name.
 * Nine such screens already exist and are `Dialog` underneath, correctly — and one,
 * `boq-item-drawer.tsx`, was deliberately moved OFF a hand-rolled side panel back onto a
 * centered `Dialog`, because a 420px side panel covered the rate column it needed to compare
 * against. Use `Sheet` where a screen is genuinely built as list-on-one-side,
 * detail-on-the-other — not as a default replacement for a confirmation or a create form.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

/**
 * Size controls the max-width of the panel.
 *
 *  md   448px  record preview, short edit form (default)
 *  lg   576px  medium form, simple inline table
 *  xl   768px  comparison views, tables with multiple columns
 *  2xl  896px  matrix/line editors with 4+ columns per row
 *
 * If the content needs more than 2xl, it belongs on a full page, not a sheet.
 */
const sheetSizeClass = {
  md: 'max-w-md',
  lg: 'max-w-xl',
  xl: 'max-w-3xl',
  '2xl': 'max-w-4xl',
} as const;

const sheetSideClass = {
  end: 'inset-y-0 end-0 w-full border-s',
  start: 'inset-y-0 start-0 w-full border-e',
} as const;

export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Which inline edge the panel docks to. Logical, so it flips correctly in RTL. */
    side?: keyof typeof sheetSideClass;
    /** Panel width tier. Defaults to 'md' (448px). Use 'xl' only for comparison tables. */
    size?: keyof typeof sheetSizeClass;
    /** Accessible name for the close control. */
    closeLabel?: string;
  }
>(({ className, children, side = 'end', size = 'md', closeLabel = 'Close', ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-sm motion-safe:animate-enter-fade" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 flex flex-col overflow-hidden border-border bg-surface-elevated shadow-e3 motion-safe:animate-enter-fade',
        sheetSideClass[side],
        sheetSizeClass[size],
        className,
      )}
      {...props}
    >
      {children}

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
SheetContent.displayName = 'SheetContent';

export const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('shrink-0 border-b border-border px-6 py-5', className)} {...props} />
);

export const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('pe-8 text-h2 font-semibold text-foreground', className)}
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
    className={cn('mt-2 text-sm text-muted-foreground', className)}
    {...props}
  />
));
SheetDescription.displayName = 'SheetDescription';

/** Scrolling body between the fixed header and footer. */
export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex-1 overflow-y-auto px-6 py-5', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col gap-3 border-t border-border px-6 py-4 sm:flex-row-reverse sm:justify-start',
        className,
      )}
      {...props}
    />
  );
}
