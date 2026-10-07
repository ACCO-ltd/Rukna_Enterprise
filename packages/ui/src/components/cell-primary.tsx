import * as React from 'react';

import { cn } from '../lib/utils';

export interface CellPrimaryProps {
  /** Where the record opens. The label is the row's one explicit link. */
  href: string;
  label: React.ReactNode;
  /** A quiet second line: the code, the client, the source document. */
  sub?: React.ReactNode;
  /**
   * Let a long label wrap onto more lines instead of truncating — for names (a project, a
   * client) where the end of the name matters. Document numbers stay on one line.
   */
  wrap?: boolean;
  /** Renders the link — pass Next's `<Link>`. Defaults to a plain `<a>`. */
  renderLink?: (props: {
    href: string;
    className: string;
    children: React.ReactNode;
  }) => React.ReactNode;
  className?: string;
}

const defaultRenderLink: NonNullable<CellPrimaryProps['renderLink']> = ({
  href,
  className,
  children,
}) => (
  <a href={href} className={className}>
    {children}
  </a>
);

/**
 * A table row's identity cell: the record's name or number as the row's one link, and a quiet
 * line under it. The rest of the row is not a competing click target.
 */
export function CellPrimary({
  href,
  label,
  sub,
  wrap = false,
  renderLink = defaultRenderLink,
  className,
}: CellPrimaryProps) {
  return (
    <div className={cn('min-w-0', className)}>
      {renderLink({
        href,
        className: cn(
          'font-medium text-brand-primary hover:text-brand-primary-hover hover:underline focus-visible:underline focus-visible:outline-none',
          wrap ? 'block break-words' : 'block truncate',
        ),
        children: label,
      })}
      {sub ? (
        <span
          className={cn(
            'mt-0.5 block text-caption text-muted-foreground',
            wrap ? 'break-words' : 'truncate',
          )}
        >
          {sub}
        </span>
      ) : null}
    </div>
  );
}
