import { Buildings } from '@phosphor-icons/react';

/**
 * The accent tile that marks where a record starts in an entity list.
 *
 * Sanctioned by `docs/reference/ux-doctrine.md` §7 (amended 2026-09-08) under four conditions,
 * and this component exists so those conditions hold by construction rather than by everyone
 * remembering them:
 *
 *  - **One accent, one size, one glyph for the whole column.** There is no `icon` prop and no
 *    `tone` prop on purpose. The tile says "a record starts here", never what kind of record
 *    it is — the moment it varies by row it is encoding status in colour, which is the
 *    grid-of-tiles anti-pattern §7 bans.
 *  - **Decorative**, so `aria-hidden`: the record's name beside it is the accessible name.
 *
 * It also ends a real inconsistency: Clients drew this with a phosphor glyph and Projects with
 * a lucide one, so the same tile had two different silhouettes in two lists a person moves
 * between.
 */
export function RecordTile() {
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-panel bg-brand-accent text-brand-primary"
      aria-hidden="true"
    >
      <Buildings size={18} weight="regular" />
    </span>
  );
}
