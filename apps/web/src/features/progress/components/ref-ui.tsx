import * as React from 'react';
import { cn } from '@erp/ui';

/**
 * Progress-tab-only visual primitives, styled to a pasted reference design rather than the
 * repo's `@erp/ui` doctrine (explicit product decision, 2026-09-23 — scoped to this tab, not a
 * platform-wide reskin). Colors are hardcoded Tailwind, not design tokens, so this surface reads
 * identically regardless of what `@erp/ui`'s CSS variables resolve to.
 */

// ─── Card ──────────────────────────────────────────────────────────────────────────────────

export function RefCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm', className)}
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
        divider && 'pb-4 border-b border-gray-100',
        !divider && 'pb-1',
        className,
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        {icon ? <RefIconTile tone={iconTone}>{icon}</RefIconTile> : null}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p> : null}
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
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-green-50 text-green-600',
  amber: 'bg-amber-50 text-amber-600',
  gray: 'bg-gray-100 text-gray-500',
  red: 'bg-red-50 text-red-600',
  violet: 'bg-violet-50 text-violet-600',
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
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
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
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-700',
  gray: 'bg-gray-100 text-gray-600',
  red: 'bg-red-100 text-red-700',
  violet: 'bg-violet-100 text-violet-700',
};

export function RefPill({ tone = 'gray', className, children, ...props }: {
  tone?: RefTone;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
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
  primary: 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300',
  outline: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50',
  ghost: 'text-gray-600 hover:bg-gray-100 disabled:opacity-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
};

export const RefButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: RefButtonVariant; size?: 'sm' | 'default' }
>(({ className, variant = 'primary', size = 'default', ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed',
      size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4',
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
    tone === 'green' ? 'text-green-600' : tone === 'amber' ? 'text-amber-600' : 'text-gray-900';
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold tabular-nums', valueClass)}>{value}</p>
    </div>
  );
}

// ─── Table ─────────────────────────────────────────────────────────────────────────────────

export function RefTableScroll({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div tabIndex={0} role="region" className={cn('w-full overflow-x-auto', className)} {...props} />;
}

export function RefTable({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-sm', className)} {...props} />;
}

export function RefThead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('border-b border-gray-100', className)} {...props} />;
}

export function RefTbody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-gray-100', className)} {...props} />;
}

export function RefTr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-gray-50', className)} {...props} />;
}

export function RefTh({ className, numeric, ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-4 py-2.5 text-start text-xs font-medium text-gray-500',
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
      className={cn('px-4 py-3 align-middle text-gray-900', numeric && 'text-end tabular-nums', className)}
      {...props}
    />
  );
}

// ─── Progress bar (inline, table-row scale) ───────────────────────────────────────────────

export function RefBar({ percent, tone = 'blue' }: { percent: number; tone?: 'blue' | 'green' }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-gray-100">
        <div
          className={cn('h-full rounded-full', tone === 'green' ? 'bg-green-500' : 'bg-blue-500')}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="whitespace-nowrap text-xs font-medium tabular-nums text-gray-900">{`${Math.round(clamped)}%`}</span>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────────────────

export function RefEmpty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 px-6 py-10 text-center">
      <p className="text-sm font-medium text-gray-900">{title}</p>
      {hint ? <p className="mt-1 text-sm text-gray-500">{hint}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
