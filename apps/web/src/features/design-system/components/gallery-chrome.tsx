import * as React from 'react';
import { cn } from '@erp/ui';

/**
 * Layout furniture for the `/design` gallery.
 *
 * Deliberately built from the same scales it documents — `text-h2`,
 * `rounded-panel`, `shadow-e1`, `h-control` — so the gallery is itself the
 * first proof that the tokens resolve. If a scale is broken, this page breaks
 * with it rather than papering over it with one-off values.
 *
 * English-only, like the rest of this feature. See `app/design/page.tsx`.
 */

// ─── Section ──────────────────────────────────────────────────────────────────

export function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border pt-10">
      <h2 className="text-h2 font-semibold text-foreground">{title}</h2>
      {intro ? (
        <p className="mt-2 max-w-[68ch] text-body text-muted-foreground">{intro}</p>
      ) : null}
      <div className="mt-6 flex flex-col gap-8">{children}</div>
    </section>
  );
}

// ─── Specimen ─────────────────────────────────────────────────────────────────

/**
 * One component, rendered on the app canvas so it reads as product UI rather
 * than as part of the document. `token` names the thing being demonstrated —
 * a utility, a component, a CSS variable — so a reader can search for it.
 */
export function Specimen({
  label,
  token,
  note,
  children,
  bare = false,
}: {
  label: string;
  token?: string;
  note?: React.ReactNode;
  children: React.ReactNode;
  /** Drop the inner padding — for specimens that fill their frame, like a table. */
  bare?: boolean;
}) {
  return (
    <div>
      <div className="overflow-hidden rounded-container border border-border bg-background shadow-e1">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border bg-surface px-4 py-2">
          <span className="text-micro font-semibold uppercase text-muted-foreground">
            {label}
          </span>
          {token ? (
            <code className="font-mono text-caption text-brand-primary">{token}</code>
          ) : null}
        </div>
        <div className={cn('overflow-x-auto', !bare && 'p-6')}>{children}</div>
      </div>
      {note ? (
        <p className="mt-2 max-w-[70ch] text-caption leading-5 text-muted-foreground">{note}</p>
      ) : null}
    </div>
  );
}

// ─── Labelled row of specimens ───────────────────────────────────────────────

export function Row({
  label,
  children,
  align = 'center',
}: {
  label: string;
  children: React.ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <div className="grid gap-2 border-b border-dashed border-border py-3 last:border-b-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <span className="pt-1 font-mono text-caption text-muted-foreground">{label}</span>
      <div
        className={cn(
          'flex min-w-0 flex-wrap gap-3',
          align === 'center' ? 'items-center' : 'items-start',
        )}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Do / don't note ─────────────────────────────────────────────────────────

export function Rule({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-[70ch] rounded-panel border border-brand-primary/20 bg-brand-accent px-4 py-3 text-body-sm leading-6 text-brand-ink-soft">
      {children}
    </p>
  );
}

/**
 * Flags a gap between what the system specifies and what the code currently
 * does. These are the Phase 1 and Phase 2 worklist, kept next to the specimen
 * they concern so the list cannot drift away from the thing it describes.
 */
export function Pending({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-[70ch] rounded-panel border border-warning/25 bg-warning-subtle px-4 py-3 text-body-sm leading-6 text-warning">
      <span className="me-1.5 font-mono text-micro font-semibold uppercase">Not yet</span>
      {children}
    </p>
  );
}
