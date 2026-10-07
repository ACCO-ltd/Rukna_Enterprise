import * as React from 'react';

import { cn } from '../lib/utils';

export interface PanelHeaderProps {
  title: React.ReactNode;
  /** One quiet line under the title. */
  sub?: React.ReactNode;
  /** ONE header action: a link or a compact secondary button — never the screen's primary. */
  action?: React.ReactNode;
  titleId?: string;
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

/** A panel's heading row — also used above a table that draws its own frame. */
export function PanelHeader({
  title,
  sub,
  action,
  titleId,
  headingLevel = 'h2',
  className,
}: PanelHeaderProps) {
  const Heading = headingLevel;
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-1', className)}>
      <div className="min-w-0">
        <Heading id={titleId} className="text-body font-semibold text-foreground">
          {title}
        </Heading>
        {sub ? <p className="mt-0.5 text-caption text-muted-foreground">{sub}</p> : null}
      </div>
      {action ? <div className="shrink-0 text-body-sm">{action}</div> : null}
    </div>
  );
}

export interface PanelProps extends Omit<PanelHeaderProps, 'titleId' | 'className'> {
  /** No body padding: a list or table fills the panel edge to edge. */
  flush?: boolean;
  id?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * The titled panel of a workspace view: a heading, an optional one-line `sub`, one optional
 * header action, then the content. Don't nest panels, and don't wrap a single fact in one.
 */
export function Panel({
  title,
  sub,
  action,
  headingLevel,
  flush = false,
  id,
  className,
  children,
}: PanelProps) {
  const generatedId = React.useId();
  const titleId = `${id ?? generatedId}-title`;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn('overflow-hidden rounded-panel border border-border bg-surface', className)}
    >
      <PanelHeader
        title={title}
        sub={sub}
        action={action}
        titleId={titleId}
        headingLevel={headingLevel}
        className="border-b border-border px-4 py-3"
      />
      <div className={flush ? undefined : 'p-4'}>{children}</div>
    </section>
  );
}
