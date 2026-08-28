import { describe, expect, it } from 'vitest';

import {
  draftLineAmount,
  draftNet,
  emptyDraftLine,
  isDraftLineComplete,
  toLinePayloads,
  type DraftLine,
} from './variations-draft';

function line(overrides: Partial<DraftLine>): DraftLine {
  return { ...emptyDraftLine('l'), ...overrides };
}

describe('variations-draft — signed net composition', () => {
  it('an addition contributes a positive amount', () => {
    expect(draftLineAmount(line({ quantity: '10', unitRate: '5', kind: 'ADDITION' }))).toBe(50);
  });

  it('an omission contributes a negative amount, regardless of typed sign', () => {
    // The user types positive magnitudes; the sign comes from the kind toggle, not a typed minus.
    expect(draftLineAmount(line({ quantity: '10', unitRate: '5', kind: 'OMISSION' }))).toBe(-50);
    expect(draftLineAmount(line({ quantity: '10', unitRate: '5', kind: 'OMISSION' }))).toBe(
      draftLineAmount(line({ quantity: '10', unitRate: '5', kind: 'OMISSION' })),
    );
  });

  it('an incomplete line contributes null (never a silent zero)', () => {
    expect(draftLineAmount(line({ quantity: '', unitRate: '5' }))).toBeNull();
    expect(draftLineAmount(line({ quantity: '10', unitRate: '' }))).toBeNull();
  });

  it('running net mixes additions and omissions to a signed total', () => {
    const net = draftNet([
      line({ quantity: '100', unitRate: '10', kind: 'ADDITION' }), // +1000
      line({ quantity: '40', unitRate: '5', kind: 'OMISSION' }), //  -200
    ]);
    expect(net).toBe(800);
  });

  it('a net omission is negative', () => {
    const net = draftNet([
      line({ quantity: '10', unitRate: '10', kind: 'ADDITION' }), // +100
      line({ quantity: '50', unitRate: '10', kind: 'OMISSION' }), // -500
    ]);
    expect(net).toBe(-400);
  });
});

describe('variations-draft — payload conversion', () => {
  it('applies the negative sign to omission quantities exactly once, in the payload', () => {
    const payloads = toLinePayloads([
      line({ description: 'Extra tiling', quantity: '20', unitRate: '15', kind: 'ADDITION' }),
      line({ description: 'Removed skirting', quantity: '8', unitRate: '12', kind: 'OMISSION' }),
    ]);
    expect(payloads).toEqual([
      { description: 'Extra tiling', quantity: 20, unitRate: 15 },
      { description: 'Removed skirting', quantity: -8, unitRate: 12 },
    ]);
  });

  it('drops incomplete lines from the payload', () => {
    const payloads = toLinePayloads([
      line({ description: 'Complete', quantity: '1', unitRate: '2', kind: 'ADDITION' }),
      line({ description: '', quantity: '1', unitRate: '2' }), // no description
      line({ description: 'No figures', quantity: '', unitRate: '' }),
    ]);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.description).toBe('Complete');
  });

  it('isDraftLineComplete requires description and both figures', () => {
    expect(isDraftLineComplete(line({ description: 'x', quantity: '1', unitRate: '2' }))).toBe(true);
    expect(isDraftLineComplete(line({ description: '', quantity: '1', unitRate: '2' }))).toBe(false);
    expect(isDraftLineComplete(line({ description: 'x', quantity: '', unitRate: '2' }))).toBe(false);
  });
});
