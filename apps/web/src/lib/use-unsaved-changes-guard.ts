'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

/**
 * Asks before in-app navigation throws unsaved edits away.
 *
 * The App Router has no navigation-blocking API, so this covers the two ways the app moves between
 * pages without a full reload:
 *
 *  - **Internal links** (`next/link` renders plain `<a href>`): a capture-phase click listener on
 *    the document intercepts a plain left-click on a same-origin link that leads somewhere else.
 *    Modified clicks (new tab/window), `target` other than `_self`, downloads and hash-only links
 *    are left alone.
 *  - **Programmatic navigation** that a component routes through `guardedNavigate()` — today the
 *    narrow-screen pickers of the workspace tabs (`workspace-tabs.tsx`) and the module tabs
 *    (`module-tabs.tsx`), which call `router.push` from a select.
 *
 * Follow-up: the app has other programmatic `router.push` calls (row navigation in data grids,
 * post-save redirects, the command menu, …) that do not go through `guardedNavigate()` yet. Any of
 * them that can fire while a guarded screen has unsaved edits should be wrapped the same way.
 *
 * A reload or tab close is not covered here; pair this with a `beforeunload` listener.
 *
 * One guard is active at a time (the screen with unsaved edits). The caller renders the
 * confirmation from the returned state, so it can reuse its own discard wording.
 */

type Interceptor = (proceed: () => void) => void;

let activeInterceptor: Interceptor | null = null;

/** Runs `go` now, or — when a screen has unsaved edits — after the user agrees to leave. */
export function guardedNavigate(go: () => void): void {
  if (activeInterceptor) activeInterceptor(go);
  else go();
}

export interface UnsavedChangesGuard {
  /** A navigation is waiting on the user's answer. */
  open: boolean;
  /** Leave: discard the edits and carry on to where the user was going. */
  confirm: () => void;
  /** Stay on the page with the edits intact. */
  cancel: () => void;
}

export function useUnsavedChangesGuard(active: boolean): UnsavedChangesGuard {
  const router = useRouter();
  const pending = React.useRef<(() => void) | null>(null);
  /** Removes this guard's click listener and interceptor; set while the guard is attached. */
  const detach = React.useRef<(() => void) | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!active) return;

    const intercept: Interceptor = (proceed) => {
      pending.current = proceed;
      setOpen(true);
    };
    activeInterceptor = intercept;

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const here = window.location;
      if (url.pathname === here.pathname && url.search === here.search) return;

      event.preventDefault();
      event.stopPropagation();
      intercept(() => router.push(url.pathname + url.search + url.hash));
    };

    document.addEventListener('click', onClick, true);
    const remove = () => {
      document.removeEventListener('click', onClick, true);
      if (activeInterceptor === intercept) activeInterceptor = null;
      detach.current = null;
    };
    detach.current = remove;
    return remove;
  }, [active, router]);

  const confirm = React.useCallback(() => {
    const go = pending.current;
    pending.current = null;
    setOpen(false);
    // Detach first — listener and interceptor — so the navigation this releases, and any click
    // made while it is on its way, is not intercepted again.
    detach.current?.();
    go?.();
  }, []);

  const cancel = React.useCallback(() => {
    pending.current = null;
    setOpen(false);
  }, []);

  return { open, confirm, cancel };
}
