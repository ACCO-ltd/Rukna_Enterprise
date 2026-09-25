import * as React from 'react';
import { cn } from '@erp/ui';

/**
 * Progress-tab visual primitives — the reference design made canonical and token-backed.
 *
 * These components use design tokens from globals.css (--surface, --border, --brand-primary, etc.)
 * instead of hardcoded Tailwind gray-* / blue-* values, so they participate in dark mode,
 * density, and any future theme override. The visual output on the default light theme is
 * identical to the reference design.
 *
 * Components here are Progress/Programme-specific; generic primitives (Button, Alert, Badge, etc.)
 * should be imported directly from `@erp/ui`.
 */

// ─── Card ──────────────────────────────────────────────────────────────────────────────────

export function RefCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('overflow-hidden rounded-container border border-border bg-surface shadow-e1', className)}
      {...props}
    />
  );
}

export function RefCardHeader({
  icon,
  iconTone = 'blue',
  title,
  subtitle,
  action,
  divider = false,
  className,
}: {
  icon?: React.ReactNode;
  iconTone?: RefTone;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  divider?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 px-5 pt-5',
        divider && 'border-b border-border pb-4',
        !divider && 'pb-1',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <RefIconTile tone={iconTone}>{icon}</RefIconTile> : null}
        <div className="min-w-0">
          <h3 className="text-body font-semibold text-foreground">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-caption text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function RefCardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}

// ─── Icon tile ─────────────────────────────────────────────────────────────────────────────

export type RefTone = 'blue' | 'green' | 'amber' | 'gray' | 'red' | 'violet';

const iconToneClass: Record<RefTone, string> = {
  blue:   'bg-brand-accent text-brand-primary',
  green:  'bg-success-subtle text-success',
  amber:  'bg-warning-subtle text-warning',
  gray:   'bg-muted text-muted-foreground',
  red:    'bg-danger-subtle text-danger',
  violet: 'bg-historical-subtle text-historical',
};

export function RefIconTile({ tone = 'blue', className, children }: {
  tone?: RefTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-panel',
        iconToneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ─── Pill (status) ─────────────────────────────────────────────────────────────────────────

const pillToneClass: Record<RefTone, string> = {
  blue:   'bg-brand-accent-strong text-brand-primary',
  green:  'bg-success-subtle text-success',
  amber:  'bg-warning-subtle text-warning',
  gray:   'bg-muted text-muted-foreground',
  red:    'bg-danger-subtle text-danger',
  violet: 'bg-historical-subtle text-historical',
};

export function RefPill({ tone = 'gray', className, children, ...props }: {
  tone?: RefTone;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-caption font-medium',
        pillToneClass[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

// ─── Button ────────────────────────────────────────────────────────────────────────────────

type RefButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';

const buttonVariantClass: Record<RefButtonVariant, string> = {
  primary: 'bg-brand-primary text-brand-on-primary hover:bg-brand-primary-hover disabled:opacity-50',
  outline: 'border border-border bg-surface text-foreground hover:bg-surface-subtle disabled:opacity-50',
  ghost:   'text-muted-foreground hover:bg-surface-hover disabled:opacity-50',
  danger:  'bg-danger text-danger-foreground hover:bg-danger-hover disabled:opacity-50',
};

export const RefButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: RefButtonVariant; size?: 'sm' | 'default' }
>(({ className, variant = 'primary', size = 'default', ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control text-body font-medium transition-colors disabled:cursor-not-allowed',
      size === 'sm' ? 'h-8 px-3 text-caption' : 'h-9 px-4',
      buttonVariantClass[variant],
      className,
    )}
    {...props}
  />
));
RefButton.displayName = 'RefButton';

// ─── Stat tile ─────────────────────────────────────────────────────────────────────────────

export function RefStatTile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'default' | 'green' | 'amber' }) {
  const valueClass =
    tone === 'green' ? 'text-success' : tone === 'amber' ? 'text-warning' : 'text-foreground';
  return (
    <div>
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-h2 font-semibold tabular-nums', valueClass)}>{value}</p>
    </div>
  );
}

// ─── Table ─────────────────────────────────────────────────────────────────────────────────

export function RefTableScroll({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div tabIndex={0} role="region" className={cn('w-full overflow-x-auto', className)} {...props} />;
}

export function RefTable({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-body', className)} {...props} />;
}

export function RefThead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('border-b border-border', className)} {...props} />;
}

export function RefTbody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-border', className)} {...props} />;
}

export function RefTr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-surface-subtle', className)} {...props} />;
}

export function RefTh({ className, numeric, ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-4 py-2.5 text-start text-caption font-medium text-muted-foreground',
        numeric && 'text-end',
        className,
      )}
      {...props}
    />
  );
}

export function RefTd({ className, numeric, ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn('px-4 py-3 align-middle text-foreground', numeric && 'text-end tabular-nums', className)}
      {...props}
    />
  );
}

// ─── Progress bar (inline, table-row scale) ───────────────────────────────────────────────

export function RefBar({ percent, tone = 'blue' }: { percent: number; tone?: 'blue' | 'green' }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', tone === 'green' ? 'bg-success' : 'bg-brand-primary')}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="whitespace-nowrap text-caption font-medium tabular-nums text-foreground">{`${Math.round(clamped)}%`}</span>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────────────────

export function RefEmpty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-panel border border-dashed border-border px-6 py-10 text-center">
      <p className="text-body font-medium text-foreground">{title}</p>
      {hint ? <p className="mt-1 text-body text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
