/**
 * ─── Print a report ───────────────────────────────────────────────────────────────
 *
 * There is no PDF endpoint for the statements, so "Print" is the browser's own print dialog,
 * from which the reader can save a PDF. The report table is already on screen; what makes the
 * printout usable rather than a screenshot of the whole app is the print CSS in
 * `app/globals.css` (`@media print`), which drops the sidebar, top bar and the report's own
 * controls and lets the table run edge to edge.
 *
 * This helper exists so every report calls `window.print()` the same way and so the call is a
 * no-op under test and SSR, where there is no `window.print`.
 */
export function printReport(): void {
  if (typeof window === 'undefined' || typeof window.print !== 'function') return;
  window.print();
}
