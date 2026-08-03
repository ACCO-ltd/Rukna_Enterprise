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
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-muted-foreground',
        info: 'bg-brand-primary/10 text-brand-primary',
        live: 'bg-brand-primary/15 text-brand-primary',
        accent: 'bg-brand-accent/10 text-brand-accent',
        warning: 'bg-warning-subtle text-warning',
        danger: 'bg-danger-subtle text-danger',
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
