import * as React from 'react';

import { cn } from '../lib/utils';
import type { StatusTone } from './badge';

/**
 * A short list of things someone should do next, most urgent first — each row one fact, one
 * figure and at most one command.
 *
 * The list does not decide order or urgency: the caller passes rows already ranked (the server's
 * read model owns that), and a `tone` from the app's status registry for the leading dot. The dot
 * is never the only signal — the title says what is wrong in words.
 *
 * Which row's command is the screen's primary is also the caller's call (normally the first
 * row's); this component only lays the rows out.
 */
export interface ActionListItem {
  key: string;
  /** Registry tone for the leading dot. */
  tone: StatusTone;
  title: React.ReactNode;
  /** One or two short lines under the title. */
  description?: React.ReactNode;
  /** A right-aligned figure (a MoneyDisplay, typically). */
  amount?: React.ReactNode;
  /** The one command for this row, or an explanation of why there is none. */
  action?: React.ReactNode;
}

const DOT: Record<StatusTone, string> = {
  neutral: 'bg-muted-foreground',
  progress: 'bg-progress',
  attention: 'bg-warning',
  success: 'bg-success',
  danger: 'bg-danger',
  historical: 'bg-historical',
};

export function ActionList({
  items,
  className,
  'aria-label': ariaLabel,
}: {
  items: readonly ActionListItem[];
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <ul aria-label={ariaLabel} className={cn('divide-y divide-border', className)}>
      {items.map((item) => (
        <li
          key={item.key}
          className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[0.75rem_minmax(0,1fr)_auto_auto] sm:items-center"
        >
          <span aria-hidden="true" className={cn('mt-1.5 size-2 rounded-full sm:mt-0 sm:self-start sm:translate-y-1.5', DOT[item.tone])} />
          <div className="min-w-0">
            <p className="text-body-sm font-semibold text-foreground">{item.title}</p>
            {item.description ? (
              <p className="mt-0.5 text-caption text-muted-foreground">{item.description}</p>
            ) : null}
          </div>
          {item.amount !== undefined ? (
            <div className="col-start-2 text-body-sm font-semibold tabular-nums text-foreground sm:col-start-auto sm:text-end">
              {item.amount}
            </div>
          ) : (
            <span className="hidden sm:block" />
          )}
          {item.action ? (
            <div className="col-start-2 sm:col-start-auto sm:justify-self-end">{item.action}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
