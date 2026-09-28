import { describe, expect, it } from 'vitest';

import { setupStepStates } from './setup-steps';

const none = { boqDone: false, workPackagesDone: false, baselineDone: false, milestonesDone: false };

describe('setupStepStates', () => {
  it('starts on the BOQ with everything after it locked', () => {
    expect(setupStepStates(none)).toEqual({
      boq: 'current',
      workPackages: 'locked',
      baseline: 'locked',
      milestones: 'locked',
    });
  });

  it('moves to work packages once the BOQ is baselined', () => {
    expect(setupStepStates({ ...none, boqDone: true })).toEqual({
      boq: 'done',
      workPackages: 'current',
      baseline: 'locked',
      milestones: 'locked',
    });
  });

  it('skips the optional baseline (todo) in favour of required milestones', () => {
    expect(setupStepStates({ ...none, boqDone: true, workPackagesDone: true })).toEqual({
      boq: 'done',
      workPackages: 'done',
      baseline: 'todo',
      milestones: 'current',
    });
  });

  it('makes the optional baseline current once every required step is done', () => {
    expect(
      setupStepStates({ boqDone: true, workPackagesDone: true, baselineDone: false, milestonesDone: true }),
    ).toEqual({ boq: 'done', workPackages: 'done', baseline: 'current', milestones: 'done' });
  });

  it('has no current step when everything is done', () => {
    const states = setupStepStates({ boqDone: true, workPackagesDone: true, baselineDone: true, milestonesDone: true });
    expect(Object.values(states)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('never has more than one current step', () => {
    const flags = [true, false];
    for (const boqDone of flags)
      for (const workPackagesDone of flags)
        for (const baselineDone of flags)
          for (const milestonesDone of flags) {
            const states = setupStepStates({ boqDone, workPackagesDone, baselineDone, milestonesDone });
            expect(Object.values(states).filter((s) => s === 'current').length).toBeLessThanOrEqual(1);
          }
  });
});
