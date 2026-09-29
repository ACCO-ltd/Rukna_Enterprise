import * as React from 'react';

import { cn } from '../lib/utils';
import { initialsFromName } from './avatar';

export interface ActivityTimelineEntry {
  id: string;
  /** Who did it, as a display name. Also the source of the avatar's two initials. */
  actor: string;
  /** The verb phrase after the actor's name: "executed contract", "approved as Finance Manager". */
  action: React.ReactNode;
  /** What it was done to, after the verb: "ACC-HDN-26-0005-C1". Emphasised; linked when `href` is set. */
  target?: React.ReactNode;
  /** Makes `target` a link to the record it names. Ignored without a target. */
  href?: string;
  /** When, already formatted by the caller: "15 Sep 2026, 09:12" or "2 hours ago". */
  at: string;
  /** The same moment machine-readably (ISO 8601), for `<time dateTime>`. */
  dateTime?: string;
  /** Machine event code shown after the time — `bill.approve`. For audit-facing history only. */
  code?: string;
}

export interface ActivityTimelineProps {
  entries: readonly ActivityTimelineEntry[];
  /** Tighter rhythm and a smaller avatar, for a side rail or a card. */
  compact?: boolean;
  /** Accessible name for the list: "Contract activity". */
  label?: string;
  /**
   * A "View all" affordance under the list. The caller decides what it does — open the full
   * history in a dialog (`onClick`) or navigate to it (`href`).
   */
  viewAll?: { label?: string; onClick?: () => void; href?: string };
  /**
   * Router-agnostic link rendering for `href` targets and `viewAll.href` — pass one that renders
   * Next's `<Link>`. Defaults to a plain `<a>`.
   */
  renderLink?: (props: { href: string; className: string; children: React.ReactNode }) => React.ReactNode;
  /** Shown instead of the list when there are no entries. Takes precedence over `children`. */
  empty?: React.ReactNode;
  /** Also shown when there are no entries, for callers that prefer to nest their empty state. */
  children?: React.ReactNode;
  className?: string;
}

const defaultRenderLink: NonNullable<ActivityTimelineProps['renderLink']> = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
);

/**
 * A record's history, newest first: who did what to which record, and when.
 *
 * Each entry is one sentence — **Abdi Yusuf** executed contract ACC-HDN-26-0005-C1 — with the
 * time underneath, beside an initials avatar. A hairline joins the avatars so the entries read
 * as one sequence; it stops at the last one. The actor, verb and target are separate props so
 * the emphasis and the link land on the right words in every screen rather than each caller
 * composing its own sentence markup.
 *
 * Promoted out of `document-body.tsx` (ADR-039) so project rails, dialogs and document tabs all
 * draw history the same way.
 */
export function ActivityTimeline({
  entries,
  compact = false,
  label,
  viewAll,
  renderLink = defaultRenderLink,
  empty,
  children,
  className,
}: ActivityTimelineProps) {
  if (entries.length === 0) {
    const emptyContent = empty ?? children;
    return (
      <div className={className}>
        {emptyContent ?? <p className="py-4 text-body-sm text-muted-foreground">No activity yet.</p>}
      </div>
    );
  }

  const linkClass =
    'font-medium text-brand-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ring rounded-sm';

  return (
    <div className={cn('min-w-0', className)}>
      <ol aria-label={label} className="space-y-0">
        {entries.map((entry, index) => {
          const isLast = index === entries.length - 1;
          const target = entry.target ? (
            entry.href ? (
              renderLink({ href: entry.href, className: linkClass, children: entry.target })
            ) : (
              <span className="font-medium text-foreground">{entry.target}</span>
            )
          ) : null;

          return (
            <li
              key={entry.id}
              className={cn('relative flex', compact ? 'gap-2.5' : 'gap-3', !isLast && (compact ? 'pb-3' : 'pb-5'))}
            >
              {!isLast ? (
                <span
                  aria-hidden="true"
                  data-timeline-connector=""
                  className={cn(
                    'absolute bottom-0 w-px bg-border',
                    // Centred under the avatar, starting just below it.
                    compact ? 'start-3 top-7' : 'start-3.5 top-8',
                  )}
                />
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-full border border-border bg-surface-subtle text-micro font-semibold text-muted-foreground',
                  compact ? 'size-6' : 'size-7',
                )}
              >
                {initialsFromName(entry.actor)}
              </span>
              <div className={cn('min-w-0', compact ? 'text-caption' : 'text-body-sm')}>
                <p className="text-foreground">
                  <span className="font-semibold">{entry.actor}</span> {entry.action}
                  {target ? <> {target}</> : null}
                </p>
                <p className="text-caption text-muted-foreground">
                  {entry.dateTime ? <time dateTime={entry.dateTime}>{entry.at}</time> : entry.at}
                  {entry.code ? <span className="font-mono"> · {entry.code}</span> : null}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {viewAll ? (
        <div className={compact ? 'mt-3' : 'mt-4'}>
          {viewAll.href && !viewAll.onClick ? (
            renderLink({
              href: viewAll.href,
              className: cn(linkClass, compact ? 'text-caption' : 'text-body-sm'),
              children: viewAll.label ?? 'View all',
            })
          ) : (
            <button
              type="button"
              onClick={viewAll.onClick}
              className={cn(linkClass, compact ? 'text-caption' : 'text-body-sm')}
            >
              {viewAll.label ?? 'View all'}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
