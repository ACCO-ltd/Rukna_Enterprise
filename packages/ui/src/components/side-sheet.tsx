'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '../lib/utils';
import { PortalContainerContext, isEscapeInFloatingPanel } from '../lib/portal-container';
import { useReturnFocus } from './dialog';

/**
 * A panel that slides in from the end edge over the page (ADR-047 "sheet"): for adding or checking
 * one related thing — a new client, a record's details — without leaving the form or list behind
 * it. Built on the same Radix dialog as `Dialog`, so focus trapping, Escape, the scroll lock and
 * returning focus all behave the same. Full width on phones.
 *
 * The body scrolls; the footer (when given) stays pinned with the actions.
 */
export interface SideSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Accessible label of the close button, already translated. */
  closeLabel: string;
  className?: string;
}

export function SideSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeLabel,
  className,
}: SideSheetProps) {
  const focus = useReturnFocus();
  // Floating panels inside the sheet (the Combobox list) portal into it — a modal sheet makes the
  // rest of the page inert, so a list portalled to the body could not be clicked (portal-container.ts).
  const [portalContainer, setPortalContainer] = React.useState<HTMLDivElement | null>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay motion-safe:animate-enter-fade" />
        <DialogPrimitive.Content
          {...focus}
          ref={setPortalContainer}
          // Escape in an open Combobox list closes the list, not the sheet.
          onEscapeKeyDown={(event) => {
            if (isEscapeInFloatingPanel(event)) event.preventDefault();
          }}
          className={cn(
            'fixed inset-y-0 end-0 z-50 flex w-full flex-col border-s border-border bg-surface shadow-e3 sm:max-w-[34rem]',
            'motion-safe:animate-enter-fade',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-h2 font-semibold text-foreground">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-body-sm text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close
              aria-label={closeLabel}
              className="flex size-9 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
            >
              <X size={16} aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <PortalContainerContext.Provider value={portalContainer}>{children}</PortalContainerContext.Provider>
          </div>
          {footer ? <div className="border-t border-border px-6 py-4">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
