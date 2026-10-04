'use client';

import Link from 'next/link';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  OverflowGlyph,
  RowActions,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';

/** A refused command's own message when the API sent one; the generic line otherwise. */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

export interface ListRowCommand {
  key: string;
  label: string;
  onSelect: () => void;
}

/**
 * The kebab on a procurement list row (clients-list pattern): Open, then only the commands the
 * row's state and the viewer's permissions allow. A command the backend would refuse is never
 * listed — the caller filters before passing `commands`.
 */
export function ListRowMenu({
  label,
  openHref,
  openLabel,
  commands = [],
}: {
  /** Accessible name — "Actions for MR-2026-0012". */
  label: string;
  /** Omit for a row with no page of its own (catalogue entries). */
  openHref?: string;
  openLabel?: string;
  commands?: ListRowCommand[];
}) {
  return (
    <RowActions
      overflow={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label={label}>
              <OverflowGlyph />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {openHref ? (
              <DropdownMenuItem asChild>
                <Link href={openHref}>{openLabel}</Link>
              </DropdownMenuItem>
            ) : null}
            {commands.map((command) => (
              <DropdownMenuItem key={command.key} onSelect={command.onSelect}>
                {command.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    />
  );
}
