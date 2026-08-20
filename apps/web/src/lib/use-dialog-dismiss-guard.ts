'use client';

import { useCallback } from 'react';

/**
 * Guards a dialog against dismissal while a mutation is in flight.
 *
 * Returns `onOpenChange` for `<Dialog>` and `contentProps` (the escape/outside handlers) to
 * spread onto `<DialogContent>`. Extracted because the identical "don't let the user close this
 * mid-request" block was copied across every busy dialog.
 */
export function useDialogDismissGuard(isBusy: boolean, onDismiss: () => void) {
  const preventWhileBusy = useCallback(
    (event: Event) => {
      if (isBusy) event.preventDefault();
    },
    [isBusy],
  );

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next && !isBusy) onDismiss();
    },
    [isBusy, onDismiss],
  );

  return {
    onOpenChange,
    contentProps: {
      onEscapeKeyDown: preventWhileBusy,
      onPointerDownOutside: preventWhileBusy,
      onInteractOutside: preventWhileBusy,
    },
  };
}
