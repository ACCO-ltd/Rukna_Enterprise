import type { DocumentReadResult } from '@erp/types';

import type { GrnLineDraft } from './components/grn-line-editor';

/**
 * Step 7 — a delivery note's reading applied to a goods receipt. Each line read off the note is
 * matched to the order line it most likely is (by the words they share), each order line at most
 * once; matched lines take the note's quantity, order lines not on the note take nothing (they did
 * not arrive), and note lines that match nothing are handed back to show the person. A guess is
 * never made below the threshold: an unmatched line is the person's to place.
 */
const STOP = new Set(['the', 'of', 'and', 'for', 'with', 'x', 'pcs', 'pc', 'no', 'nos']);

function words(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

/** Shared words over the smaller side's words: 1 = one description contains the other. */
export function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

const THRESHOLD = 0.5;

export interface AppliedDeliveryReading {
  lines: GrnLineDraft[];
  /** Note lines no order line matched, as read ("Cement 50kg · 20 bag"). */
  unmatched: string[];
  matchedCount: number;
}

export function applyDeliveryReading(lines: readonly GrnLineDraft[], reading: Pick<DocumentReadResult, 'lines'>): AppliedDeliveryReading {
  const readable = reading.lines.filter((r) => r.quantity !== null && Number(r.quantity) > 0);
  const candidates = readable
    .flatMap((r, ri) => lines.map((l, li) => ({ ri, li, score: similarity(r.description, l.description) })))
    .filter((c) => c.score >= THRESHOLD)
    .sort((a, b) => b.score - a.score);

  const takenRead = new Set<number>();
  const takenLine = new Map<number, number>();
  for (const c of candidates) {
    if (takenRead.has(c.ri) || takenLine.has(c.li)) continue;
    takenRead.add(c.ri);
    takenLine.set(c.li, c.ri);
  }

  const next = lines.map((line, li) => {
    const ri = takenLine.get(li);
    const read = ri === undefined ? null : (readable[ri] ?? null);
    return { ...line, delivered: read ? read.quantity! : '' };
  });
  const unmatched = readable
    .filter((_, ri) => !takenRead.has(ri))
    .map((r) => [r.description, [r.quantity, r.unit].filter(Boolean).join(' ')].filter(Boolean).join(' · '));
  return { lines: next, unmatched, matchedCount: takenLine.size };
}
