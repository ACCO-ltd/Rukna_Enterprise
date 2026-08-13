import * as React from 'react';

import { cn } from '../lib/utils';
import { LtrValue } from './ltr-value';

/**
 * The shape every detail page takes: certificate, bill, payment, order, journal,
 * contract, project.
 *
 * ─── Why one convention rather than per-page judgement ───────────────────────────
 *
 * Every detail page in the product currently stacks panels in a single column. The cost
 * is measurable: the New Project form fills roughly 770px of a 1440px window and leaves
 * the rest empty, and the totals a reader came for scroll off the top the moment they look
 * at a line item. A record has two kinds of content — the thing you work on, and the facts
 * you keep checking while you work — and they want different columns.
 *
 * ─── Zones ──────────────────────────────────────────────────────────────────────
 *
 *   RecordHeader   identifier, title, status, the one figure that defines the record,
 *                  and at most two visible actions
 *   RecordBanner   full width under the header — where the approval chain goes, so state
 *                  is the first thing read
 *   RecordBody     tabs and tables: the record's own structure
 *   RecordRail     summary, history, related. The 6–8 facts someone would otherwise
 *                  scroll for
 *
 * Below `lg` the rail moves under the body in source order, which is why summary must be
 * the first thing in it — on a phone it becomes the first thing after the tabs.
 */

// ─── Layout ───────────────────────────────────────────────────────────────────

export function RecordLayout({
  header,
  banner,
  rail,
  children,
  className,
}: {
  header: React.ReactNode;
  /** Full-width slot between header and body. The approval chain lives here. */
  banner?: React.ReactNode;
  /** Right column. Put the summary first — it is what a narrow viewport sees first. */
  rail?: React.ReactNode;
  /** Main column. */
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-5', className)}>
      {header}
      {banner}
      <div
        className={cn(
          'grid min-w-0 gap-5',
          // 1.7fr / 1fr rather than a fixed rail width: at 1440px the rail lands near
          // 360px, which is where a definition list stops wrapping its values.
          rail ? 'lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]' : 'grid-cols-1',
        )}
      >
        <div className="flex min-w-0 flex-col gap-5">{children}</div>
        {rail ? <div className="flex min-w-0 flex-col gap-5">{rail}</div> : null}
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

export function RecordHeader({
  breadcrumb,
  identifier,
  title,
  subtitle,
  status,
  figure,
  actions,
  lifecycle,
  className,
}: {
  /** Back link or breadcrumb trail, above the identifier. */
  breadcrumb?: React.ReactNode;
  /** The record's own reference — IPC-2026-0042. Rendered mono: it is a code, not a name. */
  identifier?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Status pill. */
  status?: React.ReactNode;
  /**
   * The single figure that defines this record — contract value, net certified, amount due.
   * Pass `{ label, value }`. One figure, not three: a header that lists every number is a
   * dashboard, and the reader stops reading any of them.
   */
  figure?: { label: string; value: React.ReactNode };
  /** At most two visible controls plus an overflow. */
  actions?: React.ReactNode;
  /** Lifecycle rail, rendered full width below the title row. */
  lifecycle?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-panel border border-border bg-surface shadow-e1',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 p-5">
        <div className="min-w-0">
          {breadcrumb ? <div className="mb-2">{breadcrumb}</div> : null}
          <div className="flex flex-wrap items-center gap-2.5">
            {identifier ? (
              <LtrValue as="code" className="font-mono text-caption text-muted-foreground">
                {identifier}
              </LtrValue>
            ) : null}
            {status}
          </div>
          <h1 className="mt-1.5 text-h1 font-bold text-foreground">{title}</h1>
          {subtitle ? (
            <p className="mt-1 text-body-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {figure ? (
            // Boxed and label-above so it reads as a figure rather than as another button.
            <div className="rounded-control border border-border bg-surface-subtle px-3.5 py-2">
              <span className="block text-micro font-semibold uppercase text-muted-foreground">
                {figure.label}
              </span>
              <LtrValue className="mt-0.5 block text-h3 font-semibold tabular-nums text-foreground">
                {figure.value}
              </LtrValue>
            </div>
          ) : null}
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </div>

      {lifecycle ? (
        <div className="border-t border-border px-5 py-3.5">{lifecycle}</div>
      ) : null}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

/**
 * A titled surface, used in both columns.
 *
 * `padded={false}` for a panel whose whole body is a table — a table inside padding reads
 * as floating, and its own header row already supplies the top edge.
 */
export function RecordPanel({
  title,
  action,
  meta,
  padded = true,
  children,
  className,
}: {
  title?: React.ReactNode;
  /** Right-aligned control in the panel header — a link, a small button, a count. */
  action?: React.ReactNode;
  /** Small print under the title, e.g. "as at 13 Aug 2026". */
  meta?: React.ReactNode;
  padded?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'min-w-0 overflow-hidden rounded-panel border border-border bg-surface shadow-e1',
        className,
      )}
    >
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-h3 font-semibold text-foreground">{title}</h2>
            {meta ? <p className="text-caption text-muted-foreground">{meta}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className={cn(padded && 'p-4')}>{children}</div>
    </section>
  );
}

// ─── Definition rows ──────────────────────────────────────────────────────────

/**
 * The rail's workhorse: label on the start, value on the end, hairline between.
 *
 * Rows rather than cards. A card per fact is how a summary rail becomes six inches of
 * whitespace and three facts, which is what the project overview does today.
 */
export function DefinitionList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <dl className={cn('flex flex-col', className)}>{children}</dl>;
}

export function DefinitionRow({
  label,
  children,
  numeric,
  tone,
  emptyText,
}: {
  label: React.ReactNode;
  children?: React.ReactNode;
  /** Tabular figures and end-alignment, for money and quantities. */
  numeric?: boolean;
  /** Draws attention to a value that needs it — a shortfall, an overdue balance. */
  tone?: 'default' | 'warning' | 'danger' | 'success';
  /**
   * Shown when `children` is null or undefined.
   *
   * A missing value must say it is missing. Rendering an empty cell leaves the reader unable
   * to tell "not set" from "still loading" from "I misread the row".
   */
  emptyText?: string;
}) {
  const isEmpty = children === null || children === undefined || children === '';

  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <dt className="min-w-0 shrink-0 text-caption text-muted-foreground">{label}</dt>
      <dd
        dir={numeric ? 'ltr' : undefined}
        className={cn(
          'min-w-0 text-end text-body-sm font-medium',
          numeric && 'tabular-nums [unicode-bidi:isolate]',
          isEmpty
            ? 'font-normal italic text-muted-foreground'
            : tone === 'warning'
              ? 'text-warning'
              : tone === 'danger'
                ? 'text-danger'
                : tone === 'success'
                  ? 'text-success'
                  : 'text-foreground',
        )}
      >
        {isEmpty ? (emptyText ?? '—') : children}
      </dd>
    </div>
  );
}
