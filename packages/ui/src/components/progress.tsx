import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Linear and circular determinate-progress primitives.
 *
 * ─── Why these did not exist ─────────────────────────────────────────────────────
 *
 * The same `role="progressbar"` track-and-fill idiom was independently written at least
 * three times — `finance/finance-primitives.tsx`, `finance/share-bar.tsx`, and again inside
 * `procurement/cost-commitments-view.tsx` — each with slightly different threshold/tone rules.
 * A budget-usage bar is not a one-off: it is the same component with a different `value`.
 *
 * Both take `value`/`max` rather than a pre-computed percentage, because every existing
 * caller was clamping `Math.min(100, Math.max(0, …))` by hand — that belongs here, once.
 */

export type ProgressTone = 'default' | 'success' | 'warning' | 'danger';

function clampPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

const progressFillTone: Record<ProgressTone, string> = {
  default: 'bg-brand-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export interface ProgressProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  value: number;
  max?: number;
  tone?: ProgressTone;
  /** Track height. `sm` for an inline table-row bar, `default` for a standalone one. */
  size?: 'sm' | 'default';
  /** Accessible name — a progress bar has no visible label of its own. */
  label?: string;
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ value, max = 100, tone = 'default', size = 'default', label, className, ...props }, ref) => {
    const percent = clampPercent(value, max);
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className={cn(
          'w-full overflow-hidden rounded-full bg-muted',
          size === 'sm' ? 'h-1.5' : 'h-2',
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-(--motion-layout) ease-brand',
            progressFillTone[tone],
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = 'Progress';

const meterStrokeTone: Record<ProgressTone, string> = {
  default: 'text-brand-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

export interface MeterProps {
  value: number;
  max?: number;
  /** Outer diameter in px. */
  size?: number;
  strokeWidth?: number;
  tone?: ProgressTone;
  /** Center content. Defaults to a rounded `NN%` label. */
  label?: React.ReactNode;
  className?: string;
}

/** Circular/donut meter — the "68% · $6.8M of $10.0M" ring pattern. */
export function Meter({ value, max = 100, size = 96, strokeWidth = 8, tone = 'default', label, className }: MeterProps) {
  const percent = clampPercent(value, max);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);
  const center = size / 2;

  return (
    <div
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={center} cy={center} r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-muted" />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          stroke="currentColor"
          className={cn('transition-[stroke-dashoffset] duration-(--motion-layout) ease-brand', meterStrokeTone[tone])}
        />
      </svg>
      <div
        role="img"
        aria-label={`${Math.round(percent)}%`}
        className="absolute inset-0 flex items-center justify-center text-h3 font-semibold text-foreground"
      >
        {label ?? `${Math.round(percent)}%`}
      </div>
    </div>
  );
}
