'use client';

import { useCallback, useState } from 'react';

export interface DialogDismissGuardOptions {
  /**
   * The dialog holds edits that have not been saved. A dismissal (Escape, the overlay, the close
   * button, a `<DialogClose>` Cancel) is then held and `discard.open` turns true, so the caller
   * can ask "Discard unsaved changes?" before anything is thrown away.
   */
  dirty?: boolean;
  /**
   * Whether the dialog is open. Pass it so a pending discard question is dropped when the parent
   * closes the dialog itself (after a save) — otherwise it would reappear on the next open.
   * Defaults to true for callers that unmount the dialog instead.
   */
  open?: boolean;
}

export interface DialogDismissGuard {
  /** Pass to `<Dialog onOpenChange>`. Every dismissal path is routed through it. */
  onOpenChange: (open: boolean) => void;
  /** Spread onto the dialog content: stops Escape and outside clicks outright while busy. */
  contentProps: {
    onEscapeKeyDown: (event: Event) => void;
    onPointerDownOutside: (event: Event) => void;
    onInteractOutside: (event: Event) => void;
  };
  /** The held dismissal of a dirty dialog, for the discard confirmation. */
  discard: {
    /** True while the "Discard unsaved changes?" question is being asked. */
    open: boolean;
    /** The user chose to discard: close the confirmation and dismiss the dialog. */
    confirm: () => void;
    /** The user chose to keep editing: close the confirmation only. */
    cancel: () => void;
  };
}

/**
 * Guards a dialog against being dismissed at the wrong moment.
 *
 *  - **Busy** (`isBusy`): a mutation is in flight. Every dismissal is ignored, because closing
 *    mid-request leaves the user not knowing whether the save happened.
 *  - **Dirty** (`options.dirty`): the dialog holds unsaved edits. The dismissal is held and
 *    `discard.open` turns true; `discard.confirm()` completes it, `discard.cancel()` abandons it.
 *
 * Promoted from apps/web (ADR-039) so `FormDialog` and hand-built dialogs share one rule rather
 * than each re-deriving it. Extracted there in the first place because the identical "don't let
 * the user close this mid-request" block had been copied across every busy dialog.
 */
export function useDialogDismissGuard(
  isBusy: boolean,
  onDismiss: () => void,
  options: DialogDismissGuardOptions = {},
): DialogDismissGuard {
  const dirty = options.dirty ?? false;
  const open = options.open ?? true;
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // A question about discarding only makes sense while the dialog is open AND holds edits. When
  // either stops being true (the parent closed it after a save, or the edits were saved or undone)
  // the pending question is dropped, so it cannot resurface on the next open. Adjusted during
  // render rather than in an effect, the React-documented way to reset state on a prop change.
  const guarding = open && dirty;
  const [wasGuarding, setWasGuarding] = useState(guarding);
  if (wasGuarding !== guarding) {
    setWasGuarding(guarding);
    if (!guarding) setConfirmingDiscard(false);
  }

  const preventWhileBusy = useCallback(
    (event: Event) => {
      if (isBusy) event.preventDefault();
    },
    [isBusy],
  );

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next || isBusy) return;
      if (dirty) {
        setConfirmingDiscard(true);
        return;
      }
      onDismiss();
    },
    [isBusy, dirty, onDismiss],
  );

  const confirm = useCallback(() => {
    setConfirmingDiscard(false);
    onDismiss();
  }, [onDismiss]);

  const cancel = useCallback(() => setConfirmingDiscard(false), []);

  return {
    onOpenChange,
    contentProps: {
      onEscapeKeyDown: preventWhileBusy,
      onPointerDownOutside: preventWhileBusy,
      onInteractOutside: preventWhileBusy,
    },
    discard: { open: confirmingDiscard && guarding, confirm, cancel },
  };
}
