import * as React from 'react';

/**
 * Where a floating panel should portal to.
 *
 * A modal dialog makes everything outside its content inert — `pointer-events: none` on the
 * body and a focus trap on its container. A panel portalled to `document.body` from inside the
 * dialog (the `Combobox` list) therefore opens behind the dialog, cannot be clicked, and its
 * search box cannot take focus. Dialogs provide their content element here; a panel that reads
 * it portals into the dialog instead and behaves like any other field in it.
 *
 * `null` (the default) means "no dialog": portal to the body as usual.
 */
export const PortalContainerContext = React.createContext<HTMLElement | null>(null);

export function usePortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainerContext);
}

/**
 * Marks a floating panel that handles its own Escape (the `Combobox` list).
 *
 * Radix dialogs listen for Escape on the document in the capture phase, so they hear it before
 * the panel's own key handler does — and without this, Escape in the list's search box closed the
 * whole dialog (or asked to discard it) instead of just the list. A dialog ignores an Escape that
 * starts inside a marked panel and lets the panel close itself.
 */
export const FLOATING_PANEL_ATTRIBUTE = 'data-floating-panel';

export function isEscapeInFloatingPanel(event: Event): boolean {
  const target = event.target;
  return target instanceof Element && target.closest(`[${FLOATING_PANEL_ATTRIBUTE}]`) !== null;
}
