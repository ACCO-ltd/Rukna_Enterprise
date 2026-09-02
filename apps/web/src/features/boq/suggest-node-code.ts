/**
 * Propose the next BOQ code for a new section or item.
 *
 * ─── Why this is worth doing ─────────────────────────────────────────────────────
 *
 * "Item code" was an empty box with no example, on a field that is neither free text nor
 * optional: it is the address every downstream document quotes. A certificate line, a
 * variation, a purchase-order line all point at a node by code, and the schema enforces
 * `@@unique([versionId, code])` because — in its own words — "two nodes answering to
 * 02.01.002 makes every downstream reference ambiguous". Asking for that blind means the
 * first a user hears about the convention is a rejected save.
 *
 * The dialog already knows where the node is going: it prints "Under 01.02" or "Top level"
 * above the field. That plus the siblings already there is everything needed to say what the
 * next code is, so the field arrives answered and the user only has to disagree.
 *
 * ─── The convention, read from the data rather than invented ─────────────────────
 *
 * Sections are dotted segments that deepen with the tree — `01`, then `01.02`, then
 * `01.02.03`. Items are numbered inside their section on a wider segment — `01.001`,
 * `02.01.001` — which is what keeps a section and its first item from colliding at
 * `01.01`. Segment width is taken from the siblings rather than hardcoded: a BOQ that
 * numbers its sections `001` keeps doing so.
 */

/** How many digits the siblings use, so an existing convention is continued rather than reset. */
function segmentWidth(segments: string[], fallback: number): number {
  const widths = segments.filter((s) => /^\d+$/.test(s)).map((s) => s.length);
  return widths.length > 0 ? Math.max(...widths) : fallback;
}

/** The last dotted segment of a code, or '' when it has none. */
function lastSegment(code: string): string {
  const parts = code.split('.');
  return parts[parts.length - 1] ?? '';
}

export function suggestNodeCode(
  kind: 'section' | 'item',
  /** The code of the section the node goes under, or null at the root. */
  parentCode: string | null,
  /** Codes of the nodes already under that parent. */
  siblingCodes: readonly string[],
): string {
  // Items are numbered on a wider segment than sections so that a section and the first item
  // beside it cannot both be "01.01".
  const defaultWidth = kind === 'item' ? 3 : 2;
  const prefix = parentCode ? `${parentCode}.` : '';

  // Only siblings that actually sit under this parent, and only the numeric tail.
  const tails = siblingCodes
    .filter((code) => (prefix ? code.startsWith(prefix) : !code.includes('.')))
    .map(lastSegment)
    .filter((segment) => /^\d+$/.test(segment));

  const width = segmentWidth(tails, defaultWidth);
  const highest = tails.reduce((max, segment) => Math.max(max, Number(segment)), 0);

  // A gap left by a deleted line is not filled: codes are quoted in issued documents, and
  // reusing one would point two different lines at the same reference across versions.
  return `${prefix}${String(highest + 1).padStart(width, '0')}`;
}
