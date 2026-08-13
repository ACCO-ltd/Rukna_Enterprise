import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Isolates a left-to-right value inside right-to-left text.
 *
 * ─── The bug this exists to prevent ──────────────────────────────────────────────
 *
 * A money figure or a date is a *mixed-direction run*: digits are neutral, the group
 * separators are neutral, and a trailing currency code is strongly LTR. Drop one into an
 * Arabic paragraph and the bidi algorithm reorders the segments:
 *
 *     4 862 000.00 SOS   renders as   SOS 000.00 862 4
 *     09 Aug · 09:30     renders as   Aug · 09:30 09
 *
 * Both were caught in browser QA on the approval chain and the decision panel — the figure
 * was not wrong in the DOM, it was reordered on screen. On a screen where someone approves a
 * payment, a transposed amount is the most expensive bug in the product.
 *
 * `tabular-nums` does not help: it aligns glyph widths, not direction. Nor does wrapping in
 * a `<span>` — direction is inherited, so the span joins the surrounding run.
 *
 * ─── Why `dir="ltr"` and `isolate` together ──────────────────────────────────────
 *
 * `dir="ltr"` fixes the order *inside* the element. `unicode-bidi: isolate` stops the
 * element from participating in the surrounding run at all, which is what keeps an adjacent
 * label from being dragged to the wrong side of it. One without the other leaves a case
 * broken, so this component always applies both.
 *
 * Use it for every value that is inherently written left-to-right regardless of locale:
 * money, quantities, dates, times, document references, account codes, percentages.
 * Do **not** use it for translated prose — that is what the page direction is for.
 */
export function LtrValue({
  as: Component = 'span',
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  /** Rendered element. `span` by default; pass `code` for an identifier. */
  as?: 'span' | 'code' | 'div' | 'dd' | 'p';
}) {
  return (
    <Component
      dir="ltr"
      className={cn('[unicode-bidi:isolate]', className)}
      {...props}
    >
      {children}
    </Component>
  );
}
