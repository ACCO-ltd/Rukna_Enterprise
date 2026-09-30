'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '../lib/utils';

export interface DisclosureProps {
  /** The toggle's words — "Advanced". */
  label: React.ReactNode;
  /** One line beside the label saying what is inside — "Normal balance, posting policy". */
  hint?: React.ReactNode;
  /** Uncontrolled starting state. Ignored when `open` is passed. */
  defaultOpen?: boolean;
  /**
   * Controlled state. A form passes it to open the section itself when a field inside needs
   * attention — an error hidden behind a closed toggle is an error the user cannot find.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: React.ReactNode;
}

/**
 * Fields most people never change, folded away behind one toggle.
 *
 * The content stays mounted while closed (hidden, not removed), so values typed into it and the
 * form state bound to it survive a close and reopen.
 */
export function Disclosure({
  label,
  hint,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  className,
  children,
}: DisclosureProps) {
  const [openState, setOpenState] = React.useState(defaultOpen);
  const open = openProp ?? openState;
  const regionId = React.useId();

  function toggle() {
    const next = !open;
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  }

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={toggle}
        className={cn(
          'flex w-full items-center gap-2 rounded-control py-1 text-start text-body-sm font-semibold text-foreground',
          'hover:text-brand-primary focus-visible:outline-none focus-visible:shadow-ring',
        )}
      >
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-(--motion-enter) ease-brand',
            open ? 'rotate-0' : '-rotate-90 rtl:rotate-90',
          )}
        />
        <span>{label}</span>
        {hint ? (
          <span className="min-w-0 truncate text-caption font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </button>
      <div id={regionId} hidden={!open} className="mt-3 space-y-4">
        {children}
      </div>
    </div>
  );
}
