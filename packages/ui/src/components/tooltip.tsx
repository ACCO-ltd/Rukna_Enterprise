'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '../lib/utils';

/**
 * A hover/focus hint, for the handful of places a native `title=` genuinely isn't enough —
 * explaining what "committed vs. accrued vs. actual" means on a badge, or why a payment
 * method option is disabled. Not for a truncated cell's full text: that idiom (a native
 * `title=` on the truncated span) already works, is used correctly across a dozen screens,
 * and doesn't need Radix's focus/portal machinery for something the browser already does.
 *
 * `TooltipProvider` is mounted once in `app/layout.tsx`, next to `DirectionProvider` — every
 * `Tooltip` in the app shares its `delayDuration` rather than each instance guessing one.
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-64 rounded-control border border-border bg-surface-elevated px-2.5 py-1.5 text-caption text-foreground shadow-e2',
        'motion-safe:animate-enter-fade',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = 'TooltipContent';
