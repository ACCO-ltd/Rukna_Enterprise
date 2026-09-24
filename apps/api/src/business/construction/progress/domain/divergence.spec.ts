import { classifyDivergence, DIVERGENCE_THRESHOLD } from './divergence.js';

/**
 * Pure classification, shared by the physical-vs-cost, collection-vs-physical and
 * planned-vs-actual cockpit signals. The case this guards hardest: two recorded zeros must never
 * read as "on track" — nothing has been compared yet, not "aligned".
 */
describe('classifyDivergence', () => {
  it('reports INSUFFICIENT_DATA, not ALIGNED, when both figures are exactly zero', () => {
    const result = classifyDivergence(0, 0, 'PROGRESS_AHEAD', 'COST_AHEAD');
    expect(result.status).toBe('INSUFFICIENT_DATA');
    expect(result.divergence).toBeNull();
  });

  it('reports INSUFFICIENT_DATA when either figure is null (missing data), regardless of the other', () => {
    expect(classifyDivergence(null, 40, 'PROGRESS_AHEAD', 'COST_AHEAD')).toEqual({
      divergence: null,
      status: 'INSUFFICIENT_DATA',
    });
    expect(classifyDivergence(40, null, 'PROGRESS_AHEAD', 'COST_AHEAD')).toEqual({
      divergence: null,
      status: 'INSUFFICIENT_DATA',
    });
    expect(classifyDivergence(null, null, 'PROGRESS_AHEAD', 'COST_AHEAD')).toEqual({
      divergence: null,
      status: 'INSUFFICIENT_DATA',
    });
    // Both null is not the same shape as both zero — neither figure exists at all.
    expect(classifyDivergence(null, 0, 'PROGRESS_AHEAD', 'COST_AHEAD').status).toBe('INSUFFICIENT_DATA');
    expect(classifyDivergence(0, null, 'PROGRESS_AHEAD', 'COST_AHEAD').status).toBe('INSUFFICIENT_DATA');
  });

  it('classifies a one-sided zero as real activity, not insufficient data', () => {
    // Cost has been incurred (25%) but nothing physical has been recorded yet — a real warning.
    const costOnly = classifyDivergence(0, 25, 'PROGRESS_AHEAD', 'COST_AHEAD');
    expect(costOnly.status).toBe('COST_AHEAD');
    expect(costOnly.divergence).toBe(-25);

    // Physical progress recorded (25%) but nothing spent yet — a real warning the other way.
    const physicalOnly = classifyDivergence(25, 0, 'PROGRESS_AHEAD', 'COST_AHEAD');
    expect(physicalOnly.status).toBe('PROGRESS_AHEAD');
    expect(physicalOnly.divergence).toBe(25);

    // A gap under the threshold with a real zero on one side still reads ALIGNED, not insufficient.
    const smallGap = classifyDivergence(0, 5, 'PROGRESS_AHEAD', 'COST_AHEAD');
    expect(smallGap.status).toBe('ALIGNED');
    expect(smallGap.divergence).toBe(-5);
  });

  it('classifies meaningful nonzero values by the threshold band, in both directions', () => {
    expect(classifyDivergence(62, 40, 'PROGRESS_AHEAD', 'COST_AHEAD')).toEqual({
      divergence: 22,
      status: 'PROGRESS_AHEAD',
    });
    expect(classifyDivergence(40, 62, 'PROGRESS_AHEAD', 'COST_AHEAD')).toEqual({
      divergence: -22,
      status: 'COST_AHEAD',
    });
    // Exactly at the band edge is not yet a divergence; past it is.
    expect(classifyDivergence(40 + DIVERGENCE_THRESHOLD, 40, 'PROGRESS_AHEAD', 'COST_AHEAD').status).toBe(
      'ALIGNED',
    );
    expect(
      classifyDivergence(40 + DIVERGENCE_THRESHOLD + 0.01, 40, 'PROGRESS_AHEAD', 'COST_AHEAD').status,
    ).toBe('PROGRESS_AHEAD');
  });

  it('rounds the divergence to two decimal places', () => {
    const result = classifyDivergence(33.333, 10, 'PROGRESS_AHEAD', 'COST_AHEAD');
    expect(result.divergence).toBe(23.33);
  });
});
