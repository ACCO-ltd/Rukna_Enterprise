import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils';

/**
 * Status pill.
 *
 * Every status machine in the platform needs one — projects, contracts, payment
 * applications, certificates, guarantees — and they should look identical, so the tone
 * vocabulary lives here rather than being reinvented per feature.
 *
 * Colour carries emphasis, never meaning on its own. The label is always present, so a
 * badge stays readable for colour-blind users, in monochrome print, and at the contrast
 * levels a site office monitor actually manages.
 *
 * Tones describe where a record sits in its lifecycle, not a palette:
 *
 *  - `neutral`  — not started, or finished and inert (DRAFT, CLOSED)
 *  - `info`     — progressing normally (APPROVED, UNDER_REVIEW)
 *  - `live`     — in force right now (ACTIVE, CERTIFIED)
 *  - `accent`   — a transitional state someone is expected to move along (MOBILIZING)
 *  - `warning`  — needs attention or is winding down (PRACTICAL_COMPLETION, CLOSEOUT)
 *  - `danger`   — stopped short of its normal end (CANCELLED, TERMINATED, REJECTED)
 */
const badgeVariants = cva(
  'inline-flex min-h-6 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-muted-foreground',
        info: 'border-brand-primary/20 bg-brand-accent text-brand-primary',
        live: 'border-success/20 bg-success-subtle text-success',
        accent: 'border-historical/20 bg-historical-subtle text-historical',
        warning: 'border-warning/20 bg-warning-subtle text-warning',
        danger: 'border-danger/20 bg-danger-subtle text-danger',
        historical: 'border-historical/25 bg-historical-subtle text-historical',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, className }))} {...props} />;
}
