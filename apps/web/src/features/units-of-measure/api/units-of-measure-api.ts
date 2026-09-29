import { apiClient } from '@/lib/api-client';
import type { UnitOfMeasureLookupStatus, UnitOfMeasureOption } from '@erp/types';

/**
 * `GET /units-of-measure` — the org's unit registry as `{ code, name, symbol }`, readable by any
 * signed-in member. For pickers (the BOQ unit column). Managing units is
 * `/procurement/uom` (procurement-api.ts), behind `manage:procurement-config`.
 */
export function listUnitsOfMeasure(
  status: UnitOfMeasureLookupStatus = 'ACTIVE',
): Promise<UnitOfMeasureOption[]> {
  return apiClient<UnitOfMeasureOption[]>('/units-of-measure', { params: { status } });
}
