import { isMilestoneReadyToVerify } from './milestone-readiness.js';

describe('isMilestoneReadyToVerify (ADR-021 amendment 2026-09-28)', () => {
  it('is ready when PLANNED and every linked package is 100% verified', () => {
    expect(
      isMilestoneReadyToVerify('PLANNED', [{ percentComplete: 100 }, { percentComplete: 100 }]),
    ).toBe(true);
  });

  it('is not ready while any linked package is short of 100%', () => {
    expect(
      isMilestoneReadyToVerify('PLANNED', [{ percentComplete: 100 }, { percentComplete: 99 }]),
    ).toBe(false);
  });

  it('is never ready with no packages linked — no evidence either way', () => {
    expect(isMilestoneReadyToVerify('PLANNED', [])).toBe(false);
  });

  it('is not ready once VERIFIED — there is nothing left to verify', () => {
    expect(isMilestoneReadyToVerify('VERIFIED', [{ percentComplete: 100 }])).toBe(false);
  });
});
