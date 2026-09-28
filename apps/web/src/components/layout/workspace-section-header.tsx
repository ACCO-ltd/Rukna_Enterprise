import type { ReactNode } from 'react';

/**
 * The heading of a project workspace tab (NAV-002, flow plan B2): an h2 — the workspace owns the
 * page's h1 — with a one-line description and, optionally, that screen's own primary action.
 *
 * Progress, Commercial, Finance, Procurement and Documents each wrote this by hand, in two
 * weights and two heading levels. One component keeps them identical.
 */
export function WorkspaceSectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-h2 font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
