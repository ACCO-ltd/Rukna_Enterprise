'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { cn } from '../lib/utils';

/**
 * A non-modal overlay anchored to its trigger.
 *
 * ─── Why Radix, and why not another vendor ───────────────────────────────────────
 *
 * The library already depends on Radix for Dialog, DropdownMenu and Tabs. A popover needs
 * exactly the things those already solved here — collision-aware placement, focus return,
 * dismissal on Escape and outside press, portalling out of `overflow: hidden` ancestors —
 * and picking a second primitive vendor for one component would mean two focus models and
 * two dismissal conventions in the same form.
 *
 * ─── Popover, not Dialog ─────────────────────────────────────────────────────────
 *
 * A calendar attached to a field is not modal: the page behind it stays meaningful, and
 * trapping focus and locking scroll to pick a date would be heavier than the decision. This
 * closes on outside press and returns focus to the trigger, which is all it needs to.
 */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 w-auto rounded-panel border border-border bg-surface-elevated p-3 text-foreground shadow-e3',
        'motion-safe:animate-enter-fade',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = 'PopoverContent';
