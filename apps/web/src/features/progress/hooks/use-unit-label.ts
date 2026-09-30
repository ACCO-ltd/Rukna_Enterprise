'use client';

import { useCallback } from 'react';

import { canonicalUnit } from '@/features/units-of-measure/unit-aliases';
import { useUnitsOfMeasure } from '@/features/units-of-measure/hooks/use-units-of-measure';

/**
 * How Progress shows a BOQ unit: the registry's listed symbol when the stored unit resolves to one
 * ("m3" → "m³", "sqm" → "m²"), else the unit as stored. Display only — nothing is rewritten, and
 * while the registry is loading (or unavailable) the stored unit shows unchanged.
 */
export function useUnitLabel(): (unit: string | null | undefined) => string {
  const units = useUnitsOfMeasure();
  return useCallback((unit) => (unit ? canonicalUnit(units.data, unit) : ''), [units.data]);
}
