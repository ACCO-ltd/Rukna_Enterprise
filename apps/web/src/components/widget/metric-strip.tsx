import Link from 'next/link';

import { LtrValue } from '@erp/ui';

/**
 * A row of metrics separated by vertical hairlines — the calmer, denser alternative to a
 * grid of bordered KPI cards (ux-doctrine §2.2). There is deliberately no border or shadow
 * around each segment: the hairline rules carry the structure, which is the single biggest
 * lever against a "boxed-everything" screen (§2.1, §7).
 *
 * A segment may be a whole-segment link to its filtered list. It is a link, not a card:
 * the affordance is one background step on hover, an accent focus ring on focus — never a
 * border. A value the system cannot provide renders `—`, never a blank or a fake `0`
 * (mirrors StatTile's honesty convention).
 *
 * App-level for now. Candidate to promote to `packages/ui` when it is reused on the project
 * Overview and reports — at which point it needs the router-agnostic `renderLink` prop that
 * StatTile uses, rather than importing `next/link` directly.
 */

export interface Metric {
  /** Micro-label above the value. Sentence-cased source, rendered uppercase by the style. */
  label: string;
  /** Already formatted for display. `null`/`undefined` renders an em-dash. */
  value: string | number | null | undefined;
  /** Optional sublabel — use only when it adds real meaning; prefer label+value for calm. */
  sublabel?: string;
  /** Makes the whole segment a link to the list behind the figure. */
  href?: string;
}

interface MetricStripProps {
  metrics: Metric[];
  /** Labels each segment for assistive tech; omit if a nearby heading already names the group. */
  'aria-label'?: string;
}

export function MetricStrip({ metrics, 'aria-label': ariaLabel }: MetricStripProps) {
  return (
    // Border rules, not cards: a top+bottom hairline on the strip and a vertical hairline
    // between segments. On a narrow viewport the row wraps to a 2-/3-column grid, still
    // hairline-separated, so it never overflows at 375px (DoD §8.2).
    <dl
      aria-label={ariaLabel}
      className="grid grid-cols-2 border-y border-border sm:grid-cols-3 lg:grid-cols-5"
    >
      {metrics.map((metric, index) => (
        <MetricSegment key={metric.label} metric={metric} index={index} />
      ))}
    </dl>
  );
}

function MetricSegment({ metric, index }: { metric: Metric; index: number }) {
  const { label, value, sublabel, href } = metric;
  const unavailable = value === null || value === undefined;

  // Hairline between segments. A left rule on every segment except the first in its row
  // would need to know the column count; instead draw a left rule on all but the very first
  // and let the grid's own wrapping hide the seam — top rules come from the row borders.
  const divider = index === 0 ? '' : 'border-s border-border';

  const body = (
    <>
      <dt className="text-micro font-semibold uppercase text-muted-foreground">{label}</dt>
      <LtrValue
        as="dd"
        className={`mt-1 block text-h1 font-bold tabular-nums ${
          unavailable ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        {unavailable ? '—' : value}
      </LtrValue>
      {sublabel ? (
        <dd className="mt-1 text-caption text-muted-foreground">{sublabel}</dd>
      ) : null}
    </>
  );

  // A linked segment is a whole-segment tap target (≥ 44px tall via min-h-[--...]) with one
  // background step on hover and an accent focus ring — no border, no shadow.
  if (href) {
    return (
      <div className={divider}>
        <Link
          href={href}
          className="flex min-h-11 flex-col justify-center px-4 py-3 transition-colors duration-(--motion-enter) ease-brand hover:bg-surface-subtle focus-visible:outline-none focus-visible:shadow-ring"
        >
          {body}
        </Link>
      </div>
    );
  }

  return <div className={`${divider} px-4 py-3`}>{body}</div>;
}
