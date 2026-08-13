import * as React from 'react';

import { cn } from '../lib/utils';
import { LtrValue } from './ltr-value';

/**
 * A headline figure with the context that makes it mean something.
 *
 * ─── Why the existing KpiCard is not enough ──────────────────────────────────────
 *
 * `KpiCard` renders a label and a number. A number with nothing to compare it to is
 * trivia: "Certified to date 4.86M" tells a project manager nothing they can act on.
 * "4.86M, up 12.4% on July" tells them the month is going well. Same query, same pixel
 * budget, completely different value.
 *
 * ─── The rule that matters most in an ERP ────────────────────────────────────────
 *
 * **A number the system does not trust must not look like one it does.** The commitment
 * ledger in this product has three known corruption defects, and the honest response is a
 * tile that flags its own figure rather than presenting a wrong one confidently — which is
 * what `note` is for, and why `value` accepts null and renders an em-dash with a reason
 * rather than a zero. A zero is a fact; a blank is an absence; they must not look alike.
 *
 * That rule also covers the two tiles found on the live project page reading "IPC
 * aggregation endpoint pending" — an unavailable figure should say what the reader can do,
 * or the tile should not be there.
 */

export type DeltaDirection = 'up' | 'down' | 'flat';

export interface StatTileProps {
  /** Short, uppercase-rendered. "Certified to date", not "Total value of certificates". */
  label: string;
  /**
   * The figure, already formatted for the locale. `null` renders an em-dash — pass
   * `unavailableReason` with it so the blank explains itself.
   */
  value: React.ReactNode | null;
  /** Currency code or unit, set smaller beside the value. */
  unit?: string;
  /**
   * Movement against a stated comparison. `direction` is what the arrow shows;
   * `isGood` decouples the colour from it, because "outstanding balance down 3%" is good
   * news pointing down and "cost variance up 8%" is bad news pointing up.
   */
  delta?: {
    value: string;
    direction: DeltaDirection;
    /** What it is measured against — "vs. Jul 2026". Never omit this. */
    context: string;
    isGood?: boolean;
  };
  /** Sparkline series, oldest first. Six to twelve points read well; more becomes noise. */
  trend?: number[];
  /** Caveat or status beside the footer — a Badge saying the figure is unreliable. */
  note?: React.ReactNode;
  /** Shown in place of a delta when `value` is null. */
  unavailableReason?: string;
  /** Makes the whole tile a link to the list behind the figure. */
  href?: string;
  /** Render prop for the link, so packages/ui stays router-agnostic. */
  renderLink?: (props: { href: string; className: string; children: React.ReactNode }) => React.ReactNode;
  className?: string;
}

export function StatTile({
  label,
  value,
  unit,
  delta,
  trend,
  note,
  unavailableReason,
  href,
  renderLink,
  className,
}: StatTileProps) {
  const unavailable = value === null || value === undefined;

  const body = (
    <>
      <span className="block text-micro font-semibold uppercase text-muted-foreground">
        {label}
      </span>

      <LtrValue
        className={cn(
          'mt-2 block text-h1 font-bold tabular-nums',
          unavailable ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {unavailable ? '—' : value}
        {!unavailable && unit ? (
          <span className="ms-1 text-body-sm font-semibold tracking-normal text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </LtrValue>

      {(delta && !unavailable) || trend || note || (unavailable && unavailableReason) ? (
        <span className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-2">
            {delta && !unavailable ? <Delta {...delta} /> : null}
            {unavailable && unavailableReason ? (
              <span className="text-caption text-muted-foreground">{unavailableReason}</span>
            ) : null}
            {note}
          </span>
          {trend && trend.length > 1 ? <Sparkline series={trend} /> : null}
        </span>
      ) : null}

      {delta && !unavailable ? (
        <span className="mt-1 block text-caption text-muted-foreground">{delta.context}</span>
      ) : null}
    </>
  );

  const shell =
    'block min-w-0 rounded-panel border border-border bg-surface p-4 shadow-e1';

  if (href && renderLink) {
    return renderLink({
      href,
      className: cn(
        shell,
        'transition-colors duration-(--motion-enter) ease-brand hover:bg-surface-subtle',
        'focus-visible:outline-none focus-visible:shadow-ring',
        className,
      ),
      children: body,
    });
  }

  return <div className={cn(shell, className)}>{body}</div>;
}

// ─── Delta ────────────────────────────────────────────────────────────────────

function Delta({ value, direction, isGood }: NonNullable<StatTileProps['delta']>) {
  // Colour follows meaning, not direction. An outstanding balance falling is good news
  // pointing down; a cost variance rising is bad news pointing up. Defaulting `isGood` to
  // "up is good" is right often enough to be a useful default and wrong often enough that
  // it has to be overridable.
  const good = isGood ?? direction === 'up';
  const tone =
    direction === 'flat' ? 'text-muted-foreground' : good ? 'text-success' : 'text-danger';

  return (
    <LtrValue className={cn('inline-flex items-center gap-1 text-caption font-semibold tabular-nums', tone)}>
      <Arrow direction={direction} />
      {value}
    </LtrValue>
  );
}

function Arrow({ direction }: { direction: DeltaDirection }) {
  if (direction === 'flat') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M1.6 5h6.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  const up = direction === 'up';
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d={up ? 'M5 8.4V1.6M5 1.6L2.2 4.4M5 1.6l2.8 2.8' : 'M5 1.6v6.8M5 8.4L2.2 5.6M5 8.4l2.8-2.8'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

/**
 * Deliberately unlabelled and unmeasured: it shows shape, not values.
 *
 * `aria-hidden` because a screen reader gains nothing from a path — the figure and the
 * delta beside it carry the whole story in text. The last point is marked, because the
 * question a sparkline answers is "where did it end up".
 */
function Sparkline({ series }: { series: number[] }) {
  const W = 72;
  const H = 22;
  const min = Math.min(...series);
  const max = Math.max(...series);
  // A flat series would divide by zero; draw it down the middle instead.
  const span = max - min || 1;

  const points = series.map((v, i) => {
    const x = (i / (series.length - 1)) * W;
    const y = H - ((v - min) / span) * (H - 4) - 2;
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const last = points[points.length - 1];

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="shrink-0 overflow-visible">
      <path d={area} className="fill-brand-primary/10" />
      <path
        d={line}
        className="stroke-brand-primary"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {last ? <circle cx={last[0]} cy={last[1]} r="2.2" className="fill-brand-primary" /> : null}
    </svg>
  );
}
