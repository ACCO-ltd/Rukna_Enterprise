import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils';

/**
 * Status pill.
 *
 * Colour carries emphasis, never meaning on its own. The label is always present, so a
 * badge stays readable for colour-blind users, in monochrome print, and at the contrast
 * levels a site office monitor actually manages.
 *
 * The six canonical tones (ADR-034) describe where a record sits in its lifecycle:
 *
 *  - `neutral`    — draft or not started
 *  - `progress`   — submitted, pending, open, partially done
 *  - `attention`  — needs action, exception, expiring, returned
 *  - `success`    — approved, posted, active, matched, verified
 *  - `danger`     — rejected, failed, overdue, disputed
 *  - `historical` — closed, cancelled, superseded, reversed, withdrawn, archived
 *
 * Which tone a given status gets is decided in one place — the app's status registry —
 * never per screen. `brand-primary` is deliberately absent: it means "interactive".
 *
 * The pre-ADR-034 tone names (`info`, `live`, `accent`, `warning`) are kept as deprecated
 * aliases so existing call sites keep compiling while they migrate to the registry.
 */
const TONE_CLASSES = {
  neutral: 'border-border bg-muted text-muted-foreground',
  progress: 'border-progress/20 bg-progress-subtle text-progress',
  attention: 'border-warning/20 bg-warning-subtle text-warning',
  success: 'border-success/20 bg-success-subtle text-success',
  danger: 'border-danger/20 bg-danger-subtle text-danger',
  historical: 'border-historical/20 bg-historical-subtle text-historical',
} as const;

const badgeVariants = cva(
  'inline-flex min-h-6 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        ...TONE_CLASSES,
        /** @deprecated use `progress` */
        info: TONE_CLASSES.progress,
        /** @deprecated use `success` */
        live: TONE_CLASSES.success,
        /** @deprecated use `historical` */
        accent: TONE_CLASSES.historical,
        /** @deprecated use `attention` */
        warning: TONE_CLASSES.attention,
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

/** The six canonical status tones. Prefer this type over `BadgeTone` in new code. */
export type StatusTone = keyof typeof TONE_CLASSES;

export const STATUS_TONES: readonly StatusTone[] = [
  'neutral',
  'progress',
  'attention',
  'success',
  'danger',
  'historical',
];

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /**
   * Prefixes the label with a filled dot in the badge's own colour. Status pills always
   * carry it; classification badges (a category, a type) never do — a dot implies a
   * lifecycle the thing does not have. Decorative: the label carries the meaning.
   */
  dot?: boolean;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, dot, children, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ tone, className }), dot && 'gap-1.5')} {...props}>
      {dot ? (
        <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      ) : null}
      {children}
    </span>
  ),
);
Badge.displayName = 'Badge';

/**
 * A lifecycle status: a pill with the tone dot, always. Use for any record's current
 * state; use plain `Badge` for classification labels (type, category).
 */
export const StatusPill = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ tone = 'neutral', dot = true, ...props }, ref) => (
    <Badge ref={ref} tone={tone} dot={dot} {...props} />
  ),
);
StatusPill.displayName = 'StatusPill';

/** @deprecated Renamed to `StatusPill` (ADR-034). */
export const StatusBadge = StatusPill;

export interface StatusTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: BadgeTone;
  /** Names the axis, e.g. "Posting". Rendered before the value: "Posting: Pending". */
  axis?: string;
}

const DOT_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-muted-foreground',
  progress: 'bg-progress',
  attention: 'bg-warning',
  success: 'bg-success',
  danger: 'bg-danger',
  historical: 'bg-historical',
  info: 'bg-progress',
  live: 'bg-success',
  accent: 'bg-historical',
  warning: 'bg-warning',
};

/**
 * A secondary status axis — quieter than a pill. A document shows exactly one primary
 * `StatusPill` (its document status); the other axes (posting, match) render as dot + text
 * so three pills never compete on one row. Name the axis when the value alone is
 * ambiguous: "Posting: Pending", not "Pending".
 */
export const StatusText = React.forwardRef<HTMLSpanElement, StatusTextProps>(
  ({ tone, axis, className, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground',
        className,
      )}
      {...props}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASSES[tone])} aria-hidden="true" />
      {axis ? <span>{axis}:</span> : null}
      <span className="font-medium text-foreground">{children}</span>
    </span>
  ),
);
StatusText.displayName = 'StatusText';
