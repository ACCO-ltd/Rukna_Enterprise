import type { StepState } from '@/components/step-section';

/** Plan & setup's four steps, in order. */
export type SetupStepKey = 'boq' | 'workPackages' | 'baseline' | 'milestones';

export interface SetupStepFacts {
  /** The BOQ has a baselined (or contract) version. */
  boqDone: boolean;
  /** Packages exist, every measurable one has items, and the server says weights total 100%. */
  workPackagesDone: boolean;
  /** A governing programme baseline has been locked. */
  baselineDone: boolean;
  /** At least one milestone exists. */
  milestonesDone: boolean;
}

const ORDER: SetupStepKey[] = ['boq', 'workPackages', 'baseline', 'milestones'];
/** The planned baseline is optional; the tab works without it. */
const OPTIONAL: ReadonlySet<SetupStepKey> = new Set(['baseline']);

/**
 * The state of every step, so exactly one is `current` while anything required is left.
 *
 * - A step is `locked` while what it depends on is unfinished: work packages wait for the BOQ;
 *   the baseline and milestones wait for work packages.
 * - The first unfinished, unlocked REQUIRED step is `current`. The optional baseline becomes
 *   current only once every required step is done; until then it is `todo` (collapsed, marked
 *   Optional) rather than stealing the one primary from a required step.
 * - When everything is done there is no current step.
 */
export function setupStepStates(facts: SetupStepFacts): Record<SetupStepKey, StepState> {
  const done: Record<SetupStepKey, boolean> = {
    boq: facts.boqDone,
    workPackages: facts.workPackagesDone,
    baseline: facts.baselineDone,
    milestones: facts.milestonesDone,
  };
  const locked: Record<SetupStepKey, boolean> = {
    boq: false,
    workPackages: !facts.boqDone,
    baseline: !facts.workPackagesDone,
    milestones: !facts.workPackagesDone,
  };

  const open = ORDER.filter((key) => !done[key] && !locked[key]);
  const current = open.find((key) => !OPTIONAL.has(key)) ?? open[0] ?? null;

  const states = {} as Record<SetupStepKey, StepState>;
  for (const key of ORDER) {
    if (done[key]) states[key] = 'done';
    else if (locked[key]) states[key] = 'locked';
    else if (key === current) states[key] = 'current';
    else states[key] = 'todo';
  }
  return states;
}
