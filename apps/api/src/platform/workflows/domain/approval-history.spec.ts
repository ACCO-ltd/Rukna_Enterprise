import { deriveApprovalSteps } from './approval-history.js';

const names = (id: string) => ({ u1: 'Hodan Abdi', u2: 'Abdi Yusuf' })[id] ?? 'Unknown user';
const at = (iso: string) => new Date(iso);

const TWO_STEPS = [
  { stepOrder: 1, roleRequired: 'FINANCE_MANAGER', isOptional: false },
  { stepOrder: 2, roleRequired: 'COMMERCIAL_DIRECTOR', isOptional: false },
];

describe('deriveApprovalSteps', () => {
  it('marks a decided step, the current step and the steps after it', () => {
    const steps = deriveApprovalSteps(
      {
        status: 'PENDING',
        currentStepOrder: 2,
        steps: TWO_STEPS,
        actions: [{ stepOrder: 1, action: 'APPROVE', actorId: 'u1', actedAt: at('2026-09-15T09:12:00Z'), notes: 'Checked.' }],
      },
      names,
    );
    expect(steps.map((s) => s.state)).toEqual(['APPROVED', 'CURRENT']);
    expect(steps[0]).toMatchObject({
      actor: { id: 'u1', name: 'Hodan Abdi' },
      actedAt: '2026-09-15T09:12:00.000Z',
      notes: 'Checked.',
    });
    expect(steps[1]!.actor).toBeNull();
  });

  it('shows the rejecting step and cancels the rest once the instance stops', () => {
    const steps = deriveApprovalSteps(
      {
        status: 'REJECTED',
        currentStepOrder: 1,
        steps: TWO_STEPS,
        actions: [{ stepOrder: 1, action: 'REJECT', actorId: 'u1', actedAt: at('2026-09-15T09:12:00Z'), notes: null }],
      },
      names,
    );
    expect(steps.map((s) => s.state)).toEqual(['REJECTED', 'CANCELLED']);
  });

  it('lets the latest decision on a step win', () => {
    const steps = deriveApprovalSteps(
      {
        status: 'APPROVED',
        currentStepOrder: 3,
        steps: TWO_STEPS,
        actions: [
          { stepOrder: 1, action: 'REJECT', actorId: 'u1', actedAt: at('2026-09-15T09:00:00Z'), notes: null },
          { stepOrder: 1, action: 'APPROVE', actorId: 'u2', actedAt: at('2026-09-15T10:00:00Z'), notes: null },
          { stepOrder: 2, action: 'APPROVE', actorId: 'u2', actedAt: at('2026-09-15T11:00:00Z'), notes: null },
        ],
      },
      names,
    );
    expect(steps.map((s) => s.state)).toEqual(['APPROVED', 'APPROVED']);
    expect(steps[0]!.actor?.name).toBe('Abdi Yusuf');
  });

  it('treats an undecided step behind the current one as skipped, and ignores delegation', () => {
    const steps = deriveApprovalSteps(
      {
        status: 'PENDING',
        currentStepOrder: 2,
        steps: [{ ...TWO_STEPS[0]!, isOptional: true }, TWO_STEPS[1]!],
        actions: [{ stepOrder: 2, action: 'DELEGATE', actorId: 'u1', actedAt: at('2026-09-15T09:00:00Z'), notes: null }],
      },
      names,
    );
    expect(steps.map((s) => s.state)).toEqual(['SKIPPED', 'CURRENT']);
  });
});
