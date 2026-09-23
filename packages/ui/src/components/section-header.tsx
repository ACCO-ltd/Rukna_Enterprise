import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * A section title + hairline rule — the doctrine's default structural unit (§2.1). Used
 * instead of a bordered card so a group of facts reads as a section, not a box. The optional
 * `children` slot holds a right-aligned control (an edit link, a count, a small action).
 *
 * The heading is a `<h2>` uppercase micro-label; pass `id` to wire it to an
 * `aria-labelledby` on the surrounding `<section>`.
 */
export function SectionHeader({
  id,
  title,
  subtitle,
  children,
  className,
}: {
  id?: string;
  title: string;
  /** A sentence under the title — the record-detail case (`RecordHeader` already has this;
   * this is for the same need on a plain section, not for turning every hairline into one). */
  subtitle?: React.ReactNode;
  /** Right-aligned control in the header row. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // flex-wrap so a wide action (e.g. a status badge + a button) drops below the title at
        // narrow widths instead of forcing horizontal page scroll (measured on Performance @375).
        'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border pb-2',
        className,
      )}
    >
      <div className="min-w-0">
        <h2
          id={id}
          className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
        >
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1 text-body-sm normal-case tracking-normal text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
