import { useQuery } from '@tanstack/react-query';

import type { UnitOfMeasureLookupStatus } from '@erp/types';
import { listUnitsOfMeasure } from '../api/units-of-measure-api';

export const unitOfMeasureKeys = {
  all: ['units-of-measure'] as const,
  list: (status: UnitOfMeasureLookupStatus) => ['units-of-measure', { status }] as const,
};

/**
 * The unit registry for a picker. Reference data that changes rarely, so it is cached for the
 * session rather than refetched on every mount of a grid row's editor.
 */
export function useUnitsOfMeasure(status: UnitOfMeasureLookupStatus = 'ACTIVE') {
  return useQuery({
    queryKey: unitOfMeasureKeys.list(status),
    queryFn: () => listUnitsOfMeasure(status),
    staleTime: 10 * 60_000,
  });
}
