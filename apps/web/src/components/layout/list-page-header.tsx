import type { ReactNode } from 'react';

/**
 * The title block of a list page inside a workspace (ADR-047): a quiet eyebrow (the workspace
 * section), the list's name, one line of what is in it, and the page's actions on the right.
 * An h2 — the workspace owns the page's h1.
 */
export function ListPageHeader({
  eyebrow,
  title,
  summary,
  actions,
}: {
  eyebrow?: string;
  title: string;
  summary?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow ? <p className="text-body-sm text-muted-foreground">{eyebrow}</p> : null}
        <h2 className="text-display font-bold text-foreground">{title}</h2>
        {summary ? <p className="mt-0.5 text-body text-muted-foreground tabular-nums">{summary}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
