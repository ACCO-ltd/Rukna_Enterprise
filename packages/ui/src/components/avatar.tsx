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

/**
 * A stable tint for an entity's initials (ADR-047 lists: client and supplier avatars), so the same
 * client reads the same colour on every row. Tinted fills with dark ink — every pair clears 4.5:1 —
 * and never a status colour's solid fill, which would read as a status.
 */
const ENTITY_TINTS = [
  'bg-brand-accent text-brand-primary',
  'bg-success-subtle text-success',
  'bg-historical-subtle text-historical',
  'bg-warning-subtle text-warning',
  'bg-progress-subtle text-progress',
] as const;

export function entityTintClass(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return ENTITY_TINTS[Math.abs(hash) % ENTITY_TINTS.length]!;
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
