import { ProjectStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { getAvailableActions, isSuspended } from './project-actions';
import type { ProjectDetail, ProjectSuspension } from './types';

function suspension(overrides: Partial<ProjectSuspension> = {}): ProjectSuspension {
  return {
    id: 's1',
    projectId: 'p1',
    reason: 'Awaiting site access',
    suspendedAt: '2026-08-01T00:00:00.000Z',
    suspendedBy: 'user-1',
    resumedAt: null,
    resumedBy: null,
    ...overrides,
  };
}

function project(status: ProjectStatus, suspensions: ProjectSuspension[] = []): ProjectDetail {
  return {
    id: 'p1',
    organizationId: 'org-1',
    code: 'ACCO-1',
    name: 'Tower',
    description: null,
    status,
    contractValue: null,
    currency: null,
    clientName: null,
    startDate: null,
    expectedEndDate: null,
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    members: [],
    suspensions,
  };
}

describe('isSuspended', () => {
  it('is false with no suspensions', () => {
    expect(isSuspended(project(ProjectStatus.ACTIVE))).toBe(false);
  });

  it('is true while a suspension is unresolved', () => {
    expect(isSuspended(project(ProjectStatus.ACTIVE, [suspension()]))).toBe(true);
  });

  it('is false once the suspension has been resumed', () => {
    expect(
      isSuspended(project(ProjectStatus.ACTIVE, [suspension({ resumedAt: '2026-08-05T00:00:00.000Z' })])),
    ).toBe(false);
  });
});

/**
 * These mirror ProjectService's LIFECYCLE_REQUIRED_FROM and CANCEL_ALLOWED_FROM. If the
 * backend's state machine changes, these should fail — that is the point.
 */
describe('getAvailableActions — lifecycle progression', () => {
  it.each([
    [ProjectStatus.DRAFT, 'approve'],
    [ProjectStatus.APPROVED, 'mobilize'],
    [ProjectStatus.MOBILIZING, 'activate'],
    [ProjectStatus.ACTIVE, 'practical-completion'],
    [ProjectStatus.PRACTICAL_COMPLETION, 'closeout'],
    [ProjectStatus.CLOSEOUT, 'close'],
  ])('offers exactly one forward step from %s', (status, expected) => {
    expect(getAvailableActions(project(status)).advance).toBe(expected);
  });

  it.each([ProjectStatus.CLOSED, ProjectStatus.CANCELLED])(
    'offers no forward step from the terminal status %s',
    (status) => {
      expect(getAvailableActions(project(status)).advance).toBeNull();
    },
  );
});

describe('getAvailableActions — editing', () => {
  it('allows editing only in DRAFT', () => {
    expect(getAvailableActions(project(ProjectStatus.DRAFT)).canEdit).toBe(true);
    expect(getAvailableActions(project(ProjectStatus.APPROVED)).canEdit).toBe(false);
    expect(getAvailableActions(project(ProjectStatus.ACTIVE)).canEdit).toBe(false);
  });
});

describe('getAvailableActions — cancellation', () => {
  it.each([
    ProjectStatus.DRAFT,
    ProjectStatus.APPROVED,
    ProjectStatus.MOBILIZING,
    ProjectStatus.ACTIVE,
  ])('allows cancelling from %s', (status) => {
    expect(getAvailableActions(project(status)).canCancel).toBe(true);
  });

  it.each([
    ProjectStatus.PRACTICAL_COMPLETION,
    ProjectStatus.CLOSEOUT,
    ProjectStatus.CLOSED,
    ProjectStatus.CANCELLED,
  ])('does not allow cancelling from %s', (status) => {
    expect(getAvailableActions(project(status)).canCancel).toBe(false);
  });
});

describe('getAvailableActions — suspension', () => {
  it('allows suspending an unsuspended, non-terminal project', () => {
    expect(getAvailableActions(project(ProjectStatus.ACTIVE)).canSuspend).toBe(true);
  });

  // The API enforces one active suspension per project with a partial unique index.
  it('does not offer a second suspension while one is active', () => {
    const actions = getAvailableActions(project(ProjectStatus.ACTIVE, [suspension()]));

    expect(actions.canSuspend).toBe(false);
    expect(actions.canResume).toBe(true);
  });

  it.each([ProjectStatus.CLOSED, ProjectStatus.CANCELLED])(
    'does not allow suspending a %s project',
    (status) => {
      expect(getAvailableActions(project(status)).canSuspend).toBe(false);
    },
  );

  it('does not offer resume when nothing is suspended', () => {
    expect(getAvailableActions(project(ProjectStatus.ACTIVE)).canResume).toBe(false);
  });

  /**
   * ProjectService.transition rejects any lifecycle change while a suspension is active.
   * Offering the button would produce a guaranteed 400.
   */
  it('withholds the forward step while suspended, and says why', () => {
    const actions = getAvailableActions(project(ProjectStatus.MOBILIZING, [suspension()]));

    expect(actions.advance).toBeNull();
    expect(actions.advanceBlockedBySuspension).toBe(true);
  });

  it('does not claim suspension is blocking when there was no step to take', () => {
    const actions = getAvailableActions(project(ProjectStatus.CLOSED, [suspension()]));

    expect(actions.advance).toBeNull();
    expect(actions.advanceBlockedBySuspension).toBe(false);
  });
});
