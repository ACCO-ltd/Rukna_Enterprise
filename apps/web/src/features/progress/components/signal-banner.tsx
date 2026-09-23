'use client';

import Link from 'next/link';

import { RefBar, RefCard, RefCardBody, RefCardHeader, RefPill, type RefTone } from './ref-ui';

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
  tone: RefTone;
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
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-gray-200 bg-white px-4 py-3"
      >
        <h2 id={headingId} className="text-sm font-semibold text-gray-900">
          {title}
        </h2>
        <p className="text-xs text-gray-500">{hint}</p>
      </section>
    );
  }

  return (
    <RefCard>
      <RefCardHeader
        icon={icon}
        title={title}
        action={
          <div className="flex items-center gap-2.5">
            <RefPill tone={tone}>{statusLabel}</RefPill>
            {link ? (
              <Link href={link.href} className="text-xs font-medium text-blue-600 hover:underline">
                {link.label}
              </Link>
            ) : null}
          </div>
        }
      />
      <RefCardBody>
        <dl className="flex flex-col gap-2.5">
          {stats.map((s) => (
            <div key={s.label} className="flex items-center gap-3">
              <dt className="w-32 shrink-0 truncate text-xs text-gray-500">{s.label}</dt>
              <dd
                className={`w-14 shrink-0 text-end text-sm font-semibold tabular-nums ${
                  s.variance ? toneClass(tone) : 'text-gray-900'
                }`}
              >
                {s.value}
              </dd>
              <dd className="min-w-0 flex-1">
                {s.percent === null || s.percent === undefined ? null : (
                  <RefBar percent={s.percent} />
                )}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 border-t border-gray-100 pt-3 text-xs leading-5 text-gray-500">{hint}</p>
      </RefCardBody>
    </RefCard>
  );
}

/** The variance takes the signal's own tone, so the number and the pill agree. */
function toneClass(tone: RefTone): string {
  if (tone === 'amber') return 'text-amber-600';
  if (tone === 'red') return 'text-red-600';
  if (tone === 'green') return 'text-green-600';
  return 'text-gray-900';
}
