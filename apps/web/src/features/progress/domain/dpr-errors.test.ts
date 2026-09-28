import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api-client';

import { mapDprError } from './dpr-errors';

const exceeds = (details?: Record<string, unknown>) =>
  new ApiError(400, 'Quantity exceeds the BOQ', 'DPR_EXCEEDS_BOQ_QUANTITY', [], details);

describe('mapDprError', () => {
  it('places each over-quantity line on its item', () => {
    const mapped = mapDprError(
      exceeds({
        lines: [
          { boqNodeId: 'n1', maxForThisReport: '12.500', unit: 'm3' },
          { boqNodeId: 'n2', maxForThisReport: 0, unit: null },
        ],
      }),
      'fallback',
      (errors) => `${Object.keys(errors).length} items over`,
    );
    expect(mapped.formError).toBe('2 items over');
    expect(mapped.fieldErrors).toEqual({
      n1: { max: '12.500', unit: 'm3' },
      n2: { max: '0', unit: null },
    });
  });

  it('skips malformed lines and keeps the usable ones', () => {
    const mapped = mapDprError(
      exceeds({
        lines: [null, 'x', { boqNodeId: '', maxForThisReport: 1 }, { boqNodeId: 'n3' }, { boqNodeId: 'n4', maxForThisReport: 2 }],
      }),
      'fallback',
    );
    expect(mapped.fieldErrors).toEqual({ n4: { max: '2', unit: null } });
    // Without a describer the server's message is still the summary — never empty.
    expect(mapped.formError).toBe('Quantity exceeds the BOQ');
  });

  it('falls back to the server message when the code has no usable lines', () => {
    expect(mapDprError(exceeds(), 'fallback')).toEqual({ fieldErrors: {}, formError: 'Quantity exceeds the BOQ' });
    expect(mapDprError(exceeds({ lines: 'nope' }), 'fallback').formError).toBe('Quantity exceeds the BOQ');
  });

  it('shows any other API error as a form-level message, preferring the first validation message', () => {
    const err = new ApiError(400, 'a; b', 'VALIDATION', ['a', 'b']);
    expect(mapDprError(err, 'fallback')).toEqual({ fieldErrors: {}, formError: 'a' });
  });

  it('uses the fallback for a non-API error', () => {
    expect(mapDprError(new Error('boom'), 'Could not save')).toEqual({ fieldErrors: {}, formError: 'Could not save' });
  });
});
