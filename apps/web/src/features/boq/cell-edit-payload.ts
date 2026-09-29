import type { UnitOfMeasureOption } from '@erp/types';

import { canonicalUnit } from '@/features/units-of-measure/unit-aliases';

import type { UpdateNodePayload } from './api/boq-api';
import type { EditableField } from './components/boq-grid';

/**
 * The PATCH for one grid cell: that field and nothing else (the node update is partial).
 *
 * Re-sending the whole row, as the grid used to, rewrote fields the user never touched — an
 * imported `5 × 100` lump sum became `1 × 500` on a description edit, and a stored `m2` became
 * `m²` on a rate edit. Now a unit is normalised to the listed symbol only when the unit cell itself
 * changed, and a lump sum's amount cell writes quantity 1 × rate = amount (node-form.ts).
 */
export function cellEditPayload(
  field: EditableField,
  value: string,
  units: readonly UnitOfMeasureOption[] | undefined,
): UpdateNodePayload {
  switch (field) {
    case 'unit':
      return { unit: canonicalUnit(units, value) };
    case 'description':
      return { description: value.trim() };
    case 'lumpSumAmount':
      return { quantity: '1', unitRate: value };
    case 'quantity':
      return { quantity: value };
    case 'unitRate':
      return { unitRate: value };
  }
}
