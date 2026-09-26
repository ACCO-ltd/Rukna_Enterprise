/**
 * The authoritative next-code generator (BOQ refinement Phase 2 — D2: the server assigns codes,
 * the user never types one).
 *
 * A code is the address every downstream document quotes (a certificate line, a variation, a PO
 * line all point at a node by code, and `@@unique([versionId, code])` enforces it), so it must not
 * be a blank box the user guesses at. This derives the next code from where the node sits in the
 * tree and the direct children already there.
 *
 * The convention: sections and items both use natural numbers — `1`, `1.2`, `1.2.3`. A parent
 * may contain either sub-sections or items, never both (enforced by boq-node.policy). Segment
 * width is inherited from siblings so an existing hand-typed convention (e.g. `001`) is
 * continued rather than reset. This mirrors the browser's `suggestNodeCode` exactly, so the code
 * the dialog previews is the code the server assigns.
 */

/** How many digits the siblings use, so an existing convention is continued rather than reset. */
function segmentWidth(segments: string[], fallback: number): number {
  const widths = segments.filter((segment) => /^\d+$/.test(segment)).map((segment) => segment.length);
  return widths.length > 0 ? Math.max(...widths) : fallback;
}

/** The last dotted segment of a code, or '' when it has none. */
function lastSegment(code: string): string {
  const parts = code.split('.');
  return parts[parts.length - 1] ?? '';
}

export function proposeNodeCode(
  kind: 'section' | 'item',
  /** The code of the section the node goes under, or null at the root. */
  parentCode: string | null,
  /** Codes of the nodes already directly under that parent. */
  childCodes: readonly string[],
): string {
  const defaultWidth = 1;
  const prefix = parentCode ? `${parentCode}.` : '';

  const tails = childCodes
    .filter((code) => (prefix ? code.startsWith(prefix) : !code.includes('.')))
    .map(lastSegment)
    .filter((segment) => /^\d+$/.test(segment));

  const width = segmentWidth(tails, defaultWidth);
  const highest = tails.reduce((max, segment) => Math.max(max, Number(segment)), 0);

  // A gap left by a deleted line is never filled: codes are quoted in issued documents, and
  // reusing one would point two different lines at the same reference across versions.
  return `${prefix}${String(highest + 1).padStart(width, '0')}`;
}
