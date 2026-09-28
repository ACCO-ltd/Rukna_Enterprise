import * as React from 'react';

import { cn } from '../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocumentPaperIssuer {
  name: string;
  /** Postal address; line breaks are kept. */
  address?: string | null;
  /** A line under the address — "TIN 123456". Already labelled by the caller. */
  registration?: string | null;
  /** Logo image URL. Nothing is drawn when absent — the name carries the identity. */
  logoUrl?: string | null;
  /** Alt text for the logo. Defaults to the issuer name. */
  logoAlt?: string;
}

export interface DocumentPaperParty {
  /** "Bill to". */
  label: string;
  name: string;
  address?: string | null;
}

export interface DocumentPaperFact {
  label: string;
  value: React.ReactNode;
}

export interface DocumentPaperLine {
  key: string;
  description: React.ReactNode;
  /** A quieter second line — the stage, the variation reference. */
  detail?: React.ReactNode;
  /** Already formatted (a `MoneyDisplay`, usually) — the paper does no arithmetic. */
  amount: React.ReactNode;
}

export interface DocumentPaperTotalRow {
  label: string;
  value: React.ReactNode;
}

export interface DocumentPaperProps {
  issuer: DocumentPaperIssuer;
  /** The document word — "INVOICE", "CREDIT NOTE". */
  title: string;
  /** The document number, or null before one is assigned. */
  number: string | null;
  /** Shown in place of the number while it is null — "Number assigned on issue". */
  numberPendingLabel: string;
  billTo: DocumentPaperParty;
  /** Invoice date, due date, project — label/value pairs beside the bill-to block. */
  facts?: DocumentPaperFact[];
  columns: { description: string; amount: string };
  lines: DocumentPaperLine[];
  /** Shown instead of the table when there are no lines. */
  noLinesLabel?: string;
  /** Breakdown rows above the total — Subtotal, Sales tax. */
  totals?: DocumentPaperTotalRow[];
  /** The bottom line — "Total due". */
  total?: DocumentPaperTotalRow;
  /** Replaces the totals block with one sentence, for a viewer who cannot see money. */
  totalsHiddenLabel?: string;
  /** Payment instructions or a note under the totals. */
  note?: React.ReactNode;
  /** The issuer's footer line — registration, bank, contact. */
  footer?: React.ReactNode;
  /**
   * A diagonal word across the sheet — "DRAFT". Decorative only (`aria-hidden`): the state
   * must also be said in text elsewhere on the page.
   */
  watermark?: string;
  /** Accessible name for the sheet — "Invoice preview". */
  label?: string;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * A business document drawn as a printed sheet: issuer, title and number, bill-to, facts, line
 * items, totals, note and footer. The sheet stays light in both themes — it is a picture of the
 * paper the client receives, not app chrome — so it uses the two tokens that hold their value
 * across themes (`brand-on-panel` for the sheet, `brand-panel` for the ink).
 *
 * Plain data and label strings only: no router, no i18n, no money formatting. Callers pass
 * formatted amounts (so a money-blind viewer gets the hidden state, never `$0.00`), which lets the
 * same sheet serve invoices, credit notes and statements. Below `sm` the header stacks and long
 * descriptions wrap; amounts never wrap or clip.
 */
export function DocumentPaper({
  issuer,
  title,
  number,
  numberPendingLabel,
  billTo,
  facts = [],
  columns,
  lines,
  noLinesLabel,
  totals = [],
  total,
  totalsHiddenLabel,
  note,
  footer,
  watermark,
  label,
  className,
}: DocumentPaperProps) {
  return (
    <article
      aria-label={label ?? title}
      className={cn(
        'relative isolate overflow-hidden rounded-panel border border-border bg-brand-on-panel text-brand-panel shadow-e2',
        className,
      )}
    >
      {watermark ? (
        <div
          aria-hidden="true"
          data-testid="document-paper-watermark"
          className="pointer-events-none absolute inset-0 -z-10 flex select-none items-center justify-center overflow-hidden"
        >
          <span className="-rotate-30 whitespace-nowrap text-[clamp(3.5rem,14vw,8rem)] font-bold uppercase tracking-widest text-brand-panel/5">
            {watermark}
          </span>
        </div>
      ) : null}

      <div className="space-y-6 p-5 sm:p-10">
        {/* ── Issuer + title ───────────────────────────────────────────────── */}
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            {issuer.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL; next/image cannot optimise it
              <img
                src={issuer.logoUrl}
                alt={issuer.logoAlt ?? issuer.name}
                className="mb-2 h-12 w-auto max-w-[12rem] object-contain object-left"
              />
            ) : null}
            <p className="text-body font-semibold break-words">{issuer.name}</p>
            {issuer.address ? (
              <p className="whitespace-pre-line text-caption text-brand-panel/70 break-words">
                {issuer.address}
              </p>
            ) : null}
            {issuer.registration ? (
              <p className="text-caption text-brand-panel/70">{issuer.registration}</p>
            ) : null}
          </div>
          <div className="shrink-0 sm:text-end">
            <p className="text-h2 font-semibold uppercase tracking-widest">{title}</p>
            {number ? (
              <p className="mt-1 font-mono text-body-sm font-medium">{number}</p>
            ) : (
              <p className="mt-1 text-body-sm italic text-brand-panel/60">{numberPendingLabel}</p>
            )}
          </div>
        </header>

        {/* ── Bill to + facts ──────────────────────────────────────────────── */}
        <section className="grid gap-5 border-t border-brand-panel/15 pt-5 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-micro font-semibold uppercase tracking-wider text-brand-panel/60">
              {billTo.label}
            </p>
            <p className="mt-1 text-body-sm font-semibold break-words">{billTo.name}</p>
            {billTo.address ? (
              <p className="whitespace-pre-line text-caption text-brand-panel/70 break-words">
                {billTo.address}
              </p>
            ) : null}
          </div>
          {facts.length > 0 ? (
            <dl className="space-y-1.5 text-body-sm">
              {facts.map((fact) => (
                <div key={fact.label} className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-brand-panel/60">{fact.label}</dt>
                  <dd className="min-w-0 text-end font-medium break-words">{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>

        {/* ── Lines ────────────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-baseline justify-between gap-4 border-b-2 border-brand-panel/80 pb-2 text-micro font-semibold uppercase tracking-wider">
            <span>{columns.description}</span>
            <span className="shrink-0 text-end">{columns.amount}</span>
          </div>
          {lines.length === 0 ? (
            noLinesLabel ? (
              <p className="py-4 text-body-sm text-brand-panel/60">{noLinesLabel}</p>
            ) : null
          ) : (
            <ul>
              {lines.map((line) => (
                <li
                  key={line.key}
                  className="flex items-start justify-between gap-4 border-b border-brand-panel/15 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-body-sm font-medium break-words">{line.description}</p>
                    {line.detail ? (
                      <p className="mt-0.5 text-caption text-brand-panel/60 break-words">{line.detail}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-end text-body-sm tabular-nums">
                    {line.amount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Totals ───────────────────────────────────────────────────────── */}
        {totalsHiddenLabel ? (
          <p className="rounded-control border border-dashed border-brand-panel/25 px-4 py-3 text-body-sm text-brand-panel/70">
            {totalsHiddenLabel}
          </p>
        ) : total || totals.length > 0 ? (
          <dl className="ms-auto w-full space-y-1.5 text-body-sm tabular-nums sm:max-w-xs">
            {totals.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-4">
                <dt className="text-brand-panel/70">{row.label}</dt>
                <dd className="whitespace-nowrap text-end">{row.value}</dd>
              </div>
            ))}
            {total ? (
              <div className="flex items-baseline justify-between gap-4 border-t-2 border-brand-panel/80 pt-2 text-body font-semibold">
                <dt>{total.label}</dt>
                <dd className="whitespace-nowrap text-end">{total.value}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {note ? <div className="text-caption text-brand-panel/80 break-words">{note}</div> : null}

        {footer ? (
          <footer className="border-t border-brand-panel/15 pt-4 text-caption text-brand-panel/60 break-words">
            {footer}
          </footer>
        ) : null}
      </div>
    </article>
  );
}
