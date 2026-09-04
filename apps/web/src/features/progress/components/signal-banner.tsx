'use client';

import Link from 'next/link';
import { Badge, type BadgeTone } from '@erp/ui';

export interface SignalStat {
  label: string;
  value: string;
}

/** `42%`, or an em-dash when the figure is unavailable. */
export const formatPct = (v: number | null): string => (v === null ? '—' : `${v}%`);

/** Signed percentage for a divergence: `+31%` / `-31%` / `—`. */
export const formatSignedPct = (v: number | null): string =>
  v === null ? '—' : `${v > 0 ? '+' : ''}${v}%`;

/**
 * The Finance-tab signal banner: header with a status pill + a link, a row of stat tiles, then a
 * hint. Both cockpit signals (physical-vs-financial, collection-vs-progress) render through this —
 * they differ only in labels, tone, stats and link, which the callers pass in.
 */
export function SignalBanner({
  headingId,
  title,
  statusLabel,
  tone,
  hint,
  stats,
  link,
}: {
  headingId: string;
  title: string;
  statusLabel: string;
  tone: BadgeTone;
  hint: string;
  stats: SignalStat[];
  /** Cross-link into the surface that owns the detail. Omit to render no link (e.g. a self-link). */
  link?: { href: string; label: string };
}) {
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-panel border border-border bg-surface"
    >
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-5">
        <h2 id={headingId} className="text-body-sm font-semibold text-foreground">
          {title}
        </h2>
        <div className="flex items-center gap-3">
          <Badge tone={tone}>{statusLabel}</Badge>
          {link ? (
            <Link
              href={link.href}
              className="text-caption font-medium text-brand-primary hover:underline"
            >
              {link.label}
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-caption text-muted-foreground">{s.label}</p>
            <p className="mt-0.5 text-h3 font-bold tabular-nums text-foreground">{s.value}</p>
          </div>
        ))}
      </div>

      <p className="border-t border-border px-5 py-3 text-caption text-muted-foreground">{hint}</p>
    </section>
  );
}
