'use client';

import * as React from 'react';
import { DayPicker } from 'react-day-picker';

import { cn } from '../lib/utils';

/**
 * A month grid, on this product's tokens.
 *
 * ─── Why this is not shadcn's Calendar pasted in ─────────────────────────────────
 *
 * The structure is shadcn's — `react-day-picker` with the `classNames` map filled in — but
 * every value had to be rewritten. shadcn's calendar is styled against shadcn's own token
 * names: `bg-primary`, `text-primary-foreground`, `bg-accent`, `text-muted-foreground`,
 * `bg-background`. This product does not have `--primary`, `--accent` or `--background` in
 * those roles — it has `--brand-primary`, `--brand-accent`, `--surface`. A paste would have
 * produced a calendar that renders as unstyled boxes in light mode and near-invisible ones in
 * dark, and every class in it would trip the design-scale lint (`rounded-md`, `text-[0.8rem]`).
 * So the class map below is a translation, not a copy.
 *
 * ─── The one deviation from the reference, and why ───────────────────────────────
 *
 * Day cells are `h-9 w-9` (36px) rather than the 32px the reference uses. The doctrine sets a
 * 44px touch-target floor at 375px and 36px is what the compact density row already is; going
 * to 32 would put the smallest tap target in the product inside the control people use most on
 * a phone. The grid still fits a month in the popover width at 375px.
 */
export type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-1', className)}
      classNames={{
        months: 'flex flex-col gap-4 sm:flex-row',
        month: 'flex flex-col gap-4',
        month_caption: 'flex h-8 items-center justify-center gap-1.5 px-9',

        // In dropdown layout react-day-picker renders TWO elements per control: a real
        // `<select>` and, beside it, an aria-hidden span holding the selected label and a
        // caret. The span is what is meant to be seen and the select is meant to lie
        // invisibly on top of it as the hit target. Styling both as visible — which is what
        // this did — renders the month twice ("August August"), the year twice, and leaves
        // the caret orphaned on its own line.
        dropdown_root: 'group relative inline-flex items-center',
        dropdown: 'absolute inset-0 h-full w-full cursor-pointer opacity-0',
        caption_label: cn(
          'inline-flex items-center gap-1 rounded-control px-2 py-1 text-body-sm font-semibold text-foreground',
          'transition-colors duration-(--motion-enter) ease-brand',
          // Hover and focus belong to the label: the select sitting over it is transparent,
          // so it can never show them itself.
          'group-hover:bg-surface-hover group-focus-within:shadow-ring',
        ),

        // The nav sits across the caption rather than beside it, so the month stays centred
        // however long its name is.
        nav: 'flex items-center justify-between absolute inset-x-0 top-0 h-8 px-1',
        button_previous: navButton,
        button_next: navButton,
        chevron: 'h-4 w-4 fill-current',

        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-9 text-caption font-medium text-muted-foreground',
        weeks: '',
        week: 'mt-1 flex w-full',

        day: 'relative h-9 w-9 p-0 text-center',
        day_button: cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-control text-body-sm tabular-nums',
          'transition-colors duration-(--motion-enter) ease-brand',
          'hover:bg-surface-hover focus-visible:outline-none focus-visible:shadow-ring',
          'disabled:pointer-events-none disabled:opacity-40',
        ),

        // Selection wins over today, which wins over outside — declared in that order because
        // react-day-picker concatenates every matching flag onto one element.
        today: '[&>button]:font-semibold [&>button]:text-brand-primary',
        // Dimmed only when it is not also the selected day. Both flags land on the same cell,
        // so an unscoped opacity here washed the selection out to a pale blue whenever the
        // chosen date fell in a neighbouring month's trailing row.
        outside: cn(
          '[&:not([data-selected])>button]:text-muted-foreground',
          '[&:not([data-selected])>button]:opacity-60',
        ),
        disabled: '[&>button]:text-disabled-foreground [&>button]:opacity-40',
        hidden: 'invisible',
        selected: cn(
          '[&>button]:bg-brand-primary [&>button]:font-semibold [&>button]:text-brand-on-primary',
          '[&>button]:hover:bg-brand-primary-hover',
        ),
        range_start: '[&>button]:rounded-e-none',
        range_end: '[&>button]:rounded-s-none',
        range_middle: '[&>button]:rounded-none [&>button]:bg-brand-accent [&>button]:text-foreground',

        dropdowns: 'flex items-center gap-1',

        week_number: 'w-9 text-caption text-muted-foreground',
        week_number_header: 'w-9',
        footer: 'pt-2 text-caption text-muted-foreground',
        ...classNames,
      }}
      {...props}
    />
  );
}

const navButton = cn(
  'inline-flex h-7 w-7 items-center justify-center rounded-control border border-border bg-surface text-muted-foreground',
  'transition-colors duration-(--motion-enter) ease-brand',
  'hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:shadow-ring',
  'disabled:pointer-events-none disabled:opacity-40',
);
