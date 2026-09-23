import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Generic composable container — the byte-identical shell that 59 screens were
 * hand-writing as `rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]`
 * before this existed. This is that shell, registered once.
 *
 * `RecordPanel` (record-layout.tsx) is still the right choice for a titled record/detail
 * panel with icon + action + meta — it owns that shape already. `Card` is for everything
 * else a screen groups visually: a dashboard tile, a stat grid, a report section — anywhere
 * the caller wants full control over what goes inside rather than RecordPanel's fixed props.
 *
 * Vertical rhythm lives on `Card` itself (`py-5` + `gap-5`), not on each section, so
 * `CardHeader`/`CardContent`/`CardFooter` never fight over who owns the padding between them —
 * the same reason `DialogFooter` and `SheetFooter` don't add their own top margin either.
 *
 * @example
 * <Card>
 *   <CardHeader>
 *     <div>
 *       <CardTitle>Purchase Requisitions</CardTitle>
 *       <CardDescription>Internal requests for goods, materials, and services.</CardDescription>
 *     </div>
 *     <Button>New Requisition</Button>
 *   </CardHeader>
 *   <CardContent>…</CardContent>
 * </Card>
 */
export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col gap-5 overflow-hidden rounded-panel border border-border bg-surface py-5 text-foreground shadow-e2',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

/**
 * Title/description on the start edge, actions on the end edge — the same left/right split
 * `SectionHeader` and `RecordHeader` already use. Add `border-b border-border pb-4` (and drop
 * `Card`'s own `gap-5` contribution by wrapping) only where a screen wants a visible divider
 * under the header, e.g. a card whose body is a table — most dashboard tiles don't.
 */
export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-start justify-between gap-3 px-5', className)}
      {...props}
    />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-h3 font-semibold text-foreground', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn('mt-1 text-body-sm text-muted-foreground', className)}
      {...props}
    />
  ),
);
CardDescription.displayName = 'CardDescription';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-5', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

/**
 * Reversed on wide screens so the primary action sits on the trailing edge — the same
 * `flex-row-reverse` convention `DialogFooter` uses, for the same reason: it follows writing
 * direction instead of fighting it.
 */
export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col gap-3 px-5 sm:flex-row-reverse sm:items-center sm:justify-start', className)}
      {...props}
    />
  ),
);
CardFooter.displayName = 'CardFooter';
