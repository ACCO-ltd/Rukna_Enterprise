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
