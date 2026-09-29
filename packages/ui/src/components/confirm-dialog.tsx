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
  /**
   * The way out, when "Cancel" would be ambiguous. A discard confirmation has two cancels in
   * play — the dialog being closed and the closing itself — so it says "Keep editing".
   */
  cancelLabel?: string;
  /**
   * Which button has focus when the dialog opens. Defaults to `'confirm'` (unchanged behaviour).
   * Use `'cancel'` when Enter on the confirm button would destroy work the user did not mean to
   * lose — the discard-unsaved-changes question, where the safe answer should be the easy one.
   */
  initialFocus?: 'confirm' | 'cancel';
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
  cancelLabel = 'Cancel',
  initialFocus = 'confirm',
  isPending = false,
  variant = 'destructive',
}: ConfirmDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={isPending ? undefined : onOpenChange}>
      <DialogContent
        size="sm"
        closeLabel={cancelLabel}
        onOpenAutoFocus={(event) => {
          if (initialFocus !== 'cancel') return;
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
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
            <Button ref={cancelRef} variant="outline" disabled={isPending}>
              {cancelLabel}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
