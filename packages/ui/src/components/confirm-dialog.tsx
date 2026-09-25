'use client';

import * as React from 'react';

import { Button } from './button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Verb-first, specific title: "Delete invoice" not "Are you sure?".
   * Sentence case, no punctuation at the end.
   */
  title: React.ReactNode;
  /**
   * One sentence stating the irreversible consequence.
   * "This cannot be undone." is fine. No marketing copy, no exclamation marks.
   */
  description?: React.ReactNode;
  /**
   * Verb-first confirm label matching the title: "Delete invoice", "Remove member".
   * Never "OK", "Yes", or "Confirm".
   */
  confirmLabel: string;
  onConfirm: () => void;
  /** Set true while the mutation is in flight — disables both buttons. */
  isPending?: boolean;
  /** Defaults to 'destructive'. Use 'default' for non-destructive confirmations. */
  variant?: 'destructive' | 'default';
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  isPending = false,
  variant = 'destructive',
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={isPending ? undefined : onOpenChange}>
      <DialogContent size="sm" closeLabel="Cancel">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={isPending}
          >
            {confirmLabel}
          </Button>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
