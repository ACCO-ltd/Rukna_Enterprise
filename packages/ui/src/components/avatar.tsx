'use client';

import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Person avatar — an image with an initials fallback.
 *
 * Decorative by default (`aria-hidden`): every real usage in the app sits beside the
 * person's visible name (a user menu, a "Requested By" cell), which already carries the
 * accessible name. Pass `aria-hidden={false}` and your own `aria-label` for the rare case
 * where an avatar stands alone.
 */

const avatarSizeClass = {
  sm: 'h-7 w-7 text-micro',
  default: 'h-9 w-9 text-caption',
  lg: 'h-11 w-11 text-body-sm',
} as const;

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  src?: string | null;
  /** Full name — source for the initials fallback shown when `src` is absent or fails to load. */
  name?: string;
  size?: keyof typeof avatarSizeClass;
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function Avatar({ src, name, size = 'default', className, ...props }: AvatarProps) {
  const [errored, setErrored] = React.useState(false);
  const showImage = Boolean(src) && !errored;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-primary font-semibold text-brand-on-primary ring-2 ring-surface',
        avatarSizeClass[size],
        className,
      )}
      {...props}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- an avatar source is a tenant-supplied URL, not a static asset Next can optimize.
        <img
          src={src ?? undefined}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <span>{name ? initialsFromName(name) : null}</span>
      )}
    </span>
  );
}
