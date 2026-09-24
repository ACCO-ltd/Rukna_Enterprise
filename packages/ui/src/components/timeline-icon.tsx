import * as React from 'react';

import { cn } from '../lib/utils';
import type { BadgeTone } from './badge';

/**
 * A tinted icon tile for **timeline/activity-feed rows only** — a single glyph identifying
 * what kind of event a row is (an invoice, a milestone, a contract change), not a status.
 *
 * `RecordPanel`'s `icon` prop (`record-layout.tsx`) stays governed by the narrower rule
 * decided 2026-09-05 (`ux-doctrine.md` §7): one accent, one size, region-level only. This is
 * the documented, deliberate exception carved out for feed rows (ADR-033): a list of mixed
 * event types reads as one wall of identical bullets without a per-row glyph, the way the
 * icon-less version of `CommercialActivity` did. The tone is drawn from the same closed
 * vocabulary `Badge` already defines — not a new palette — so it stays theme- and
 * density-aware, unlike a hardcoded-Tailwind tile would be.
 *
 * Not a licence to reach for this inside `RecordPanel`, a `Card`, or a table row — those keep
 * the one-tile-per-region rule. This exists only for rows inside a timeline/feed list.
 */
const timelineIconToneClass: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-brand-accent text-brand-primary',
  live: 'bg-success-subtle text-success',
  accent: 'bg-historical-subtle text-historical',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  historical: 'bg-historical-subtle text-historical',
};

export interface TimelineIconProps {
  /** A single glyph, e.g. a `lucide-react` icon. Rendered `aria-hidden` — the row's own text
   * carries the meaning. */
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}

export function TimelineIcon({ children, tone = 'neutral', className }: TimelineIconProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-control',
        timelineIconToneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
