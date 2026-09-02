import { cn } from '@erp/ui';

/**
 * The measure of a page's content, anchored to the reading edge.
 *
 * ─── Why left-anchored and not centred ───────────────────────────────────────────
 *
 * Every page used to cap its width and then centre it (`mx-auto max-w-3xl`). On a 1193px
 * content area that leaves ~210px of empty background on *both* sides of a form, and two
 * symmetric gutters framing a narrow column is the single strongest "unfinished layout"
 * signal a screen can give — the eye reads the whitespace as the page rather than as margin.
 * Anchoring left puts the whole of the slack into one gutter on the trailing side, which is
 * what a workspace looks like: content starts where the chrome starts, and the room left over
 * is visibly room, not framing.
 *
 * It also buys alignment for free. The page title, the section rules, and the top bar's own
 * padding now share one starting x, so the vertical edge running down the left of the screen
 * is unbroken from the search field to the last form control.
 *
 * ─── Why named sizes rather than a max-width prop ────────────────────────────────
 *
 * Three widths cover every page in the product, and each is a decision about what the page
 * is for, not about how many pixels it wants. Naming them is what stops the fourth and fifth
 * from being invented: a page is a form, a record, or a table, and if it is none of those it
 * is `full`.
 */

const SIZES = {
  /** Data entry. Two columns of controls at a comfortable width, and no more. */
  form: 'max-w-4xl',
  /** A single record being read — detail pages, summaries, statements. */
  record: 'max-w-5xl',
  /** Tables and ledgers, where a cut-off column costs more than a long line does. */
  wide: 'max-w-6xl',
  /** Boards, grids and dashboards that manage their own measure. */
  full: 'max-w-none',
} as const;

export type PageColumnSize = keyof typeof SIZES;

export function PageColumn({
  size,
  className,
  children,
}: {
  size: PageColumnSize;
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn('w-full', SIZES[size], className)}>{children}</div>;
}
