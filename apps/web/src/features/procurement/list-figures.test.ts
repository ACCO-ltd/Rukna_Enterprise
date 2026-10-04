import { describe, expect, it } from 'vitest';

import { mrEstimatedTotal } from './list-figures';
import type { MaterialRequest, MaterialRequestLine } from './types';

const line = (requestedQuantity: string, estimatedUnitPrice?: string | null) =>
  ({ requestedQuantity, estimatedUnitPrice }) as MaterialRequestLine;
const request = (lines: MaterialRequestLine[], extra: Partial<MaterialRequest> = {}) =>
  ({ lines, ...extra }) as MaterialRequest;

describe('mrEstimatedTotal', () => {
  it('prefers the server total when the list sends one, even null', () => {
    expect(mrEstimatedTotal(request([line('2', '10')], { estimatedTotal: '99.00' }))).toBe('99.00');
    expect(mrEstimatedTotal(request([line('2', '10')], { estimatedTotal: null }))).toBeNull();
  });

  it('sums quantity × estimated price over the estimated lines', () => {
    expect(mrEstimatedTotal(request([line('2.5', '10.50'), line('100', '7'), line('3', null)]))).toBe('726.25');
  });

  it('is null, not zero, when no line is estimated', () => {
    expect(mrEstimatedTotal(request([line('5'), line('1', null)]))).toBeNull();
    expect(mrEstimatedTotal(request([]))).toBeNull();
  });
});
