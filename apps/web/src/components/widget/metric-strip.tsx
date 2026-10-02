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
  /**
   * Colours the sublabel (not the value) when the sublabel is the thing to act on — "3 behind
   * plan" under a neutral figure. Same rule as `tone`: only for a real variance. `danger` for an
   * overdue line ("32 days · INV-0042") under a figure that is itself neutral.
   */
  sublabelTone?: 'attention' | 'danger';
  /** Makes the whole segment a link to the list behind the figure. */
  href?: string;
  /**
   * Colours the value only when the figure is a real variance the reader must act on (ADR-034:
   * colour a figure only for a real variance) — e.g. an overdue balance above zero.
   */
  tone?: 'warning' | 'danger';
}

interface MetricStripProps {
  metrics: Metric[];
  /** Labels each segment for assistive tech; omit if a nearby heading already names the group. */
  'aria-label'?: string;
  /** Segments per row from `lg`, so the row fills instead of leaving a gap. Defaults to 5. */
  columns?: 2 | 3 | 4 | 5;
}

const LG_COLUMNS = {
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
} as const;
const SM_COLUMNS = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' } as const;

/** Two or four segments pair up at `sm`; three or five sit three to a row. */
function smColumns(columns: 2 | 3 | 4 | 5): 2 | 3 {
  return columns === 2 || columns === 4 ? 2 : 3;
}

// Literal class names, so Tailwind's scanner sees every one it needs to generate.
const RULES = {
  base: { s: 'border-s', s0: 'border-s-0', t: 'border-t', t0: 'border-t-0' },
  sm: { s: 'sm:border-s', s0: 'sm:border-s-0', t: 'sm:border-t', t0: 'sm:border-t-0' },
  lg: { s: 'lg:border-s', s0: 'lg:border-s-0', t: 'lg:border-t', t0: 'lg:border-t-0' },
} as const;

/** Hairline classes for the segment at `index`, per breakpoint. Exported for tests. */
export function segmentRules(index: number, columns: 2 | 3 | 4 | 5): string {
  const at = (bp: keyof typeof RULES, cols: number) =>
    `${index % cols === 0 ? RULES[bp].s0 : RULES[bp].s} ${index >= cols ? RULES[bp].t : RULES[bp].t0}`;
  return `border-border ${at('base', 2)} ${at('sm', smColumns(columns))} ${at('lg', columns)}`;
}

/**
 * The one metric strip for workspaces (flow plan B4): Commercial overview, Billing & collection
 * and the dashboard all use it, so a figure's label and value look the same on every tab.
 */
export function MetricStrip({ metrics, 'aria-label': ariaLabel, columns = 5 }: MetricStripProps) {
  return (
    // Border rules, not cards: a top+bottom hairline on the strip and a vertical hairline
    // between segments. On a narrow viewport the row wraps to a 2-/3-column grid, still
    // hairline-separated, so it never overflows at 375px (DoD §8.2).
    <dl
      aria-label={ariaLabel}
      className={`grid grid-cols-2 border-y border-border ${SM_COLUMNS[smColumns(columns)]} ${LG_COLUMNS[columns]}`}
    >
      {metrics.map((metric, index) => (
        <MetricSegment key={metric.label} metric={metric} index={index} columns={columns} />
      ))}
    </dl>
  );
}

function MetricSegment({
  metric,
  index,
  columns,
}: {
  metric: Metric;
  index: number;
  columns: 2 | 3 | 4 | 5;
}) {
  const { label, value, sublabel, sublabelTone, href, tone } = metric;
  const unavailable = value === null || value === undefined;

  // Hairlines per breakpoint: a left rule on every segment that is not first in its row, a top
  // rule on every segment below the first row. Computed from the column count at each
  // breakpoint — a single "left rule on all but index 0" left a stray rule on the first
  // segment of every wrapped row and no rule between rows.
  const divider = segmentRules(index, columns);

  const body = (
    <>
      <dt className="text-micro font-semibold uppercase text-muted-foreground">{label}</dt>
      <LtrValue
        as="dd"
        className={`mt-1 block text-h2 font-semibold tabular-nums ${
          unavailable
            ? 'text-muted-foreground'
            : tone === 'danger'
              ? 'text-danger'
              : tone === 'warning'
                ? 'text-warning'
                : 'text-foreground'
        }`}
      >
        {unavailable ? '—' : value}
      </LtrValue>
      {sublabel ? (
        <dd
          className={`mt-1 text-caption ${
            sublabelTone === 'attention'
              ? 'font-medium text-warning'
              : sublabelTone === 'danger'
                ? 'font-medium text-danger'
                : 'text-muted-foreground'
          }`}
        >
          {sublabel}
        </dd>
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
