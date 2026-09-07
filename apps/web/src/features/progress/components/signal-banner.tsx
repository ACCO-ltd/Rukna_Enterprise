'use client';

import Link from 'next/link';
import { Badge, RecordPanel, cn, type BadgeTone } from '@erp/ui';

export interface SignalStat {
  label: string;
  value: string;
  /** 0–100 for the comparison bar. Omit for the variance row, which is not a magnitude. */
  percent?: number | null;
  /** Draws the variance in state colour; the other rows stay neutral. */
  variance?: boolean;
}

/** `42%`, or an em-dash when the figure is unavailable. */
export const formatPct = (v: number | null): string => (v === null ? '—' : `${v}%`);

/** Signed percentage for a divergence: `+31%` / `−31%` / `—`, with a real minus sign. */
export const formatSignedPct = (v: number | null): string =>
  v === null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}%`;

/**
 * One of the two cockpit comparisons: physical progress against cost consumed, or against cash
 * collected. Both render through here — they differ only in labels, tone, figures and link.
 *
 * Two figures and the gap between them, with a bar apiece so the gap is visible before it is read.
 * The bars are the whole point of the component: "43.2% and 47.8%" is two numbers, and a reader
 * has to do the subtraction; two bars of different lengths is the finding.
 *
 * Neither figure is money, so neither is coloured. The **variance** is a state — that one is.
 */
export function SignalBanner({
  headingId,
  title,
  icon,
  statusLabel,
  tone,
  hint,
  stats,
  link,
  insufficient = false,
}: {
  headingId: string;
  title: string;
  icon?: React.ReactNode;
  statusLabel: string;
  tone: BadgeTone;
  hint: string;
  stats: SignalStat[];
  /** Cross-link into the surface that owns the detail. Omit to render no link (e.g. a self-link). */
  link?: { href: string; label: string };
  /**
   * True when the comparison cannot be made yet. Collapses to the title and the reason: a full
   * card whose figures are all em-dashes says nothing three times, and two of them stacked filled
   * half the Progress tab on every project without a contract value or a baselined budget — which is
   * every project early on.
   */
  insufficient?: boolean;
}) {
  if (insufficient) {
    return (
      <section
        aria-labelledby={headingId}
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-panel border border-border bg-surface px-4 py-3"
      >
        <h2 id={headingId} className="text-body-sm font-semibold text-foreground">
          {title}
        </h2>
        <p className="text-caption text-muted-foreground">{hint}</p>
      </section>
    );
  }

  return (
    <RecordPanel
      title={title}
      icon={icon}
      action={
        <div className="flex items-center gap-2.5">
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
      }
    >
      <dl className="flex flex-col gap-2.5">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-3">
            <dt className="w-32 shrink-0 truncate text-caption text-muted-foreground">
              {s.label}
            </dt>
            <dd
              className={cn(
                'w-14 shrink-0 text-end text-body-sm font-semibold tabular-nums',
                s.variance ? toneClass(tone) : 'text-foreground',
              )}
            >
              {s.value}
            </dd>
            <dd className="min-w-0 flex-1">
              {s.percent === null || s.percent === undefined ? null : (
                <span className="block h-2 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-brand-primary"
                    style={{ width: `${Math.min(100, Math.max(0, s.percent))}%` }}
                  />
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 border-t border-border pt-3 text-caption leading-5 text-muted-foreground">
        {hint}
      </p>
    </RecordPanel>
  );
}

/** The variance takes the signal's own tone, so the number and the pill agree. */
function toneClass(tone: BadgeTone): string {
  if (tone === 'warning') return 'text-warning';
  if (tone === 'danger') return 'text-danger';
  if (tone === 'live') return 'text-success';
  return 'text-foreground';
}
