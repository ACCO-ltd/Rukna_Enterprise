'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '../lib/utils';

/**
 * Tabs, built on Radix.
 *
 * A contract detail screen carries retention terms, advance terms, guarantees, milestones
 * and payment applications — five panels that will not fit on one screen at 375px.
 *
 * Radix supplies the roving tabindex, the arrow-key semantics and the `aria-controls`
 * wiring. It also reverses arrow-key direction under `dir="rtl"`, which matters here: in
 * Arabic, Left should move to the NEXT tab, not the previous one. That is the sort of
 * detail a hand-rolled implementation gets wrong and nobody notices until an Arabic-first
 * user tries it.
 */
export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    // Scrolls rather than wraps: five tabs on a narrow screen stay on one line and are
    // swiped, which reads as a tab strip. Wrapping to a second row reads as a broken menu.
    //
    // `overflow-y-hidden` is not decorative. Setting one axis to `auto` forces the other
    // from `visible` to `auto`, and the triggers' `-mb-px` makes the content one pixel
    // taller than the strip — so the browser rendered a vertical scrollbar next to the
    // tabs. Caught in browser QA; it showed in both directions.
    className={cn(
      'flex w-full items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // -mb-px pulls the active underline onto the list's own border so the two read as
      // one line rather than two stacked rules.
      '-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors',
      'hover:text-foreground',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary',
      'disabled:pointer-events-none disabled:opacity-50',
      'data-[state=active]:border-brand-primary data-[state=active]:text-brand-primary',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';
