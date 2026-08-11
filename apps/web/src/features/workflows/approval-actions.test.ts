import { describe, expect, it } from 'vitest';

import { approvalBlockReason, canActOnStep, stepPosition } from './approval-actions';
import type { WorkflowStep } from './types';

function step(id: string, stepOrder: number, roleRequired: string): WorkflowStep {
  return {
    id,
    definitionId: 'def-1',
    stepOrder,
    groupOrder: null,
    roleRequired,
    isOptional: false,
    escalateAfterHours: null,
    notifyRoles: [],
  };
}

const COMMERCIAL = step('s-2', 2, 'COMMERCIAL_MANAGER');

describe('canActOnStep', () => {
  it('accepts a user holding the required role', () => {
    expect(canActOnStep(COMMERCIAL, ['SITE_ENGINEER', 'COMMERCIAL_MANAGER'])).toBe(true);
  });

  it('refuses a user without it', () => {
    expect(canActOnStep(COMMERCIAL, ['SITE_ENGINEER'])).toBe(false);
  });

  /**
   * `roleRequired` is a free `String` on the step while the JWT's roles are seeded elsewhere,
   * and nothing makes the two agree on casing. A case-sensitive comparison would hide the
   * action from precisely the person meant to take it.
   */
  it('compares case-insensitively, since nothing makes the two sources agree', () => {
    expect(canActOnStep(COMMERCIAL, ['commercial_manager'])).toBe(true);
    expect(canActOnStep(step('s-1', 1, 'project_manager'), ['PROJECT_MANAGER'])).toBe(true);
  });

  it('tolerates surrounding whitespace on either side', () => {
    expect(canActOnStep(step('s-3', 3, ' CEO '), ['ceo'])).toBe(true);
  });

  it('refuses when there is no pending step', () => {
    expect(canActOnStep(null, ['COMMERCIAL_MANAGER'])).toBe(false);
  });

  /** A step requiring nothing is a misconfiguration, not an open door. */
  it('refuses a step whose required role is blank', () => {
    expect(canActOnStep(step('s-4', 4, '   '), ['ANYTHING'])).toBe(false);
  });

  it('refuses a user with no roles at all', () => {
    expect(canActOnStep(COMMERCIAL, [])).toBe(false);
  });
});

describe('approvalBlockReason', () => {
  it('distinguishes nothing pending from the wrong person', () => {
    expect(approvalBlockReason(null, ['COMMERCIAL_MANAGER'])).toBe('no-pending-step');
    expect(approvalBlockReason(COMMERCIAL, ['SITE_ENGINEER'])).toBe('wrong-role');
    expect(approvalBlockReason(COMMERCIAL, ['COMMERCIAL_MANAGER'])).toBeNull();
  });
});

describe('stepPosition', () => {
  const steps = [step('s-1', 1, 'PROJECT_MANAGER'), COMMERCIAL, step('s-3', 3, 'CEO')];

  it('reports where the step sits in the chain', () => {
    expect(stepPosition(COMMERCIAL, steps)).toEqual({ position: 2, total: 3 });
  });

  it('orders by stepOrder rather than trusting the array order', () => {
    const shuffled = [steps[2]!, steps[0]!, steps[1]!];

    expect(stepPosition(COMMERCIAL, shuffled)).toEqual({ position: 2, total: 3 });
  });

  /**
   * Possible when the definition is edited after an instance is raised. Rendering "1 of 1"
   * would be a confident lie about a chain nobody can see.
   */
  it('returns null when the step is not in the definition', () => {
    expect(stepPosition(step('s-9', 9, 'CEO'), steps)).toBeNull();
  });

  it('returns null when there is no step or no definition', () => {
    expect(stepPosition(null, steps)).toBeNull();
    expect(stepPosition(COMMERCIAL, [])).toBeNull();
  });
});
