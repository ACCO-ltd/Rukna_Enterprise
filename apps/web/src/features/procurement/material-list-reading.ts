import type { DocumentReadResult } from '@erp/types';

import { similarity } from './delivery-note-reading';
import { emptyMrItem, pickMaterial, type MrItemDraft } from './components/mr-line-editor';
import type { Material, UnitOfMeasure } from './types';

/**
 * Step 7 — a photographed material list turned into request lines. A line whose words clearly
 * name a catalogue material becomes that material (its own unit); anything else is a one-off item
 * with the unit matched by code, symbol or name. A unit that matches nothing is left blank, so the
 * form asks for it rather than guessing.
 */
const CATALOGUE_THRESHOLD = 0.75;

function unitOf(text: string | null, uoms: readonly UnitOfMeasure[]): string {
  if (!text) return '';
  const t = text.trim().toLowerCase().replace(/\.$/, '');
  const singular = t.endsWith('s') ? t.slice(0, -1) : t;
  const found = uoms.find((u) =>
    [u.code, u.symbol, u.name].some((v) => {
      const x = v.toLowerCase();
      return x === t || x === singular;
    }),
  );
  return found?.code ?? '';
}

export function itemsFromMaterialList(
  reading: Pick<DocumentReadResult, 'lines'>,
  materials: readonly Material[],
  uoms: readonly UnitOfMeasure[],
  keyOf: (index: number) => string,
): MrItemDraft[] {
  return reading.lines
    .filter((l) => l.description.trim() !== '')
    .map((l, i) => {
      const quantity = l.quantity !== null && Number(l.quantity) > 0 ? l.quantity : '';
      const best = materials
        .map((m) => ({ m, score: similarity(l.description, m.name) }))
        .sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= CATALOGUE_THRESHOLD) {
        return { ...pickMaterial(emptyMrItem(keyOf(i)), best.m), quantity };
      }
      return { ...emptyMrItem(keyOf(i)), description: l.description.trim(), uomCode: unitOf(l.unit, uoms), quantity };
    });
}
