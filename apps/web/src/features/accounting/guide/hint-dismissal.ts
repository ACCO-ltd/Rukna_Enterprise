'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Per-hint dismissal, persisted in localStorage.
 *
 * The same `useSyncExternalStore` + custom-event + `storage`-listener shape as the display
 * preference stores (`density-store.ts`), so there is one pattern for "a small client-only
 * preference read on render" rather than an effect that sets state on mount (which cascades a
 * render and trips `react-hooks/set-state-in-effect`). The SSR snapshot is always "not dismissed"
 * so the server and first client render agree; dismissal is a client action after hydration.
 */
const DISMISS_EVENT = 'rukna-guide-hint-dismiss';
const keyFor = (id: string) => `acct-guide-hint-dismissed:${id}`;

function read(id: string): boolean {
  try {
    return window.localStorage.getItem(keyFor(id)) === '1';
  } catch {
    return false;
  }
}

export function dismissGuideHint(id: string): void {
  try {
    window.localStorage.setItem(keyFor(id), '1');
  } catch {
    // Storage unavailable — the hint still hides for this view via the event below.
  }
  window.dispatchEvent(new CustomEvent(DISMISS_EVENT, { detail: id }));
}

/** True once this hint has been dismissed in this browser. False on the server and first render. */
export function useGuideHintDismissed(id: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const onDismiss = (event: Event) => {
        if (!(event instanceof CustomEvent) || event.detail === id) onStoreChange();
      };
      const onStorage = (event: StorageEvent) => {
        if (event.key === keyFor(id)) onStoreChange();
      };
      window.addEventListener(DISMISS_EVENT, onDismiss);
      window.addEventListener('storage', onStorage);
      return () => {
        window.removeEventListener(DISMISS_EVENT, onDismiss);
        window.removeEventListener('storage', onStorage);
      };
    },
    [id],
  );

  return useSyncExternalStore(
    subscribe,
    () => read(id),
    () => false,
  );
}
