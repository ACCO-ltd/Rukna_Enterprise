'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, LtrValue, cn, type BadgeTone } from '@erp/ui';
import type { FinanceControlState, FinanceControlStatus } from '@erp/types';

import { formatMoney } from '@/lib/format';

/**
 * The shared vocabulary of the Finance workspace.
 *
 * One rule runs through all of it: **a missing basis is not a zero.** A project with no baselined
 * budget has not budgeted $0; a project whose accounting was never configured has not earned $0.
 * Rendering either as a confident figure is the defect this whole workspace was built to remove,
 * so `Money` takes `null` to mean "unavailable" and says so in words.
 */

/** A money value, or an explicit absence. Never a fabricated zero. */
export function Money({
  amount,
  currency,
  className,
  unavailableLabel,
}: {
  amount: string | null | undefined;
  currency: string | null | undefined;
  className?: string;
  /** Overrides the default "Unavailable" — e.g. "Restricted" for a permissions mask. */
  unavailableLabel?: string;
}) {
  const t = useTranslations('finance.common');
  const locale = useLocale() as 'en' | 'ar';

  if (amount === null || amount === undefined) {
    return (
      <span className={cn('text-body-sm font-medium text-muted-foreground', className)}>
        {unavailableLabel ?? t('unavailable')}
      </span>
    );
  }
  const formatted = currency ? (formatMoney(amount, currency, locale) ?? amount) : amount;
  return <LtrValue className={cn('tabular-nums', className)}>{formatted}</LtrValue>;
}

/**
 * One figure in a metric band.
 *
 * `basis` is not decoration. Every money figure in Finance is only meaningful against a stated
 * basis — posted vs committed, inclusive vs exclusive of tax — and a number whose basis is
 * unstated is a number people either mistrust or, worse, misread.
 */
export function Metric({
  label,
  amount,
  currency,
  basis,
  ratio,
  emphasis = false,
  unavailableLabel,
}: {
  label: string;
  amount: string | null | undefined;
  currency: string | null | undefined;
  basis?: string | null;
  /** A named ratio, e.g. "Actual / Budget 4.2%". Absent when there is no denominator. */
  ratio?: string | null;
  emphasis?: boolean;
  unavailableLabel?: string;
}) {
  return (
    <div className="min-w-0 border-b border-border px-4 py-3.5 last:border-b-0 sm:nth-last-2:border-b-0 sm:odd:border-e xl:border-b-0 xl:not-last:border-e">
      <dt className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1.5">
        <Money
          amount={amount}
          currency={currency}
          unavailableLabel={unavailableLabel}
          className={cn('text-h2 font-bold', emphasis ? 'text-foreground' : 'text-foreground/90')}
        />
      </dd>
      {ratio ? <dd className="mt-1 text-caption text-muted-foreground">{ratio}</dd> : null}
      {!ratio && basis ? (
        <dd className="mt-1 text-caption text-muted-foreground">{basis}</dd>
      ) : null}
    </div>
  );
}

/** A band of metrics that reads as one object: same edges, same baselines, same padding. */
export function MetricBand({
  title,
  description,
  columns,
  children,
  action,
}: {
  title: string;
  description?: string;
  /** How many metrics sit in the band, so the grid fills instead of stretching. */
  columns: number;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const gridCols =
    columns >= 5
      ? 'xl:grid-cols-5'
      : columns === 4
        ? 'xl:grid-cols-4'
        : columns === 3
          ? 'xl:grid-cols-3'
          : 'xl:grid-cols-2';

  return (
    <section className="min-w-0 overflow-hidden rounded-panel border border-border bg-surface">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-h3 font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-caption text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <dl className={cn('grid grid-cols-1 sm:grid-cols-2', gridCols)}>{children}</dl>
    </section>
  );
}

const CONTROL_TONE: Record<FinanceControlState, BadgeTone> = {
  OK: 'live',
  ATTENTION: 'warning',
  UNAVAILABLE: 'neutral',
};

/**
 * One control state: is this part of the picture trustworthy?
 *
 * These are the states the backend measured, never a judgement the browser formed. Semantic
 * colour lives here and only here — money itself stays neutral, because a figure is not good or
 * bad, it is just true.
 */
export function ControlRow({
  icon,
  label,
  status,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  status: FinanceControlStatus;
  /** Overrides the server's detail line where the UI has a better phrasing for it. */
  detail?: string | null;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:px-5">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-body-sm font-medium text-foreground">{label}</p>
          {(detail ?? status.detail) ? (
            <p className="mt-0.5 text-caption text-muted-foreground">{detail ?? status.detail}</p>
          ) : null}
        </div>
      </div>
      <Badge tone={CONTROL_TONE[status.state]} className="shrink-0">
        {status.label}
      </Badge>
    </div>
  );
}

/**
 * A figure that exists but cannot be computed yet, with the reason.
 *
 * The alternative — rendering `$0.00` — is the single most misleading thing a finance screen can
 * do, because zero is itself a legitimate and very different answer.
 */
export function UnavailableNotice({
  title,
  reason,
  items,
}: {
  title: string;
  reason: string;
  items?: Array<{ label: string; detail?: string }>;
}) {
  return (
    <div className="rounded-panel border border-dashed border-border bg-surface px-5 py-6">
      <p className="text-body-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-prose text-caption text-muted-foreground">{reason}</p>
      {items && items.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {items.map((item, i) => (
            <li key={i} className="text-caption text-muted-foreground">
              <span className="font-medium text-foreground">{item.label}</span>
              {item.detail ? ` — ${item.detail}` : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A percentage that names its own numerator. A bare "%" is a guessing game. */
export function namedRatio(label: string, percent: number | null | undefined): string | null {
  if (percent === null || percent === undefined) return null;
  return `${label} ${percent}%`;
}
