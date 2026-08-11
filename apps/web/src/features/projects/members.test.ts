import { ProjectRole } from '@erp/types';
import { describe, expect, it } from 'vitest';

import type { OrgUser } from '@/features/users/types';

import {
  addableUsers,
  isLastProjectManager,
  memberName,
  memberRoles,
  removeBlockReason,
  userName,
} from './members';
import type { ProjectMember } from './types';

function member(
  id: string,
  userId: string,
  roles: ProjectRole[],
  user: Partial<ProjectMember['user']> = {},
): ProjectMember {
  return {
    id,
    userId,
    joinedAt: '2026-08-01T00:00:00.000Z',
    joinedBy: 'u-creator',
    removedAt: null,
    roles: roles.map((role, index) => ({
      id: `${id}-r${index}`,
      role,
      assignedAt: '2026-08-01T00:00:00.000Z',
      assignedBy: 'u-creator',
      removedAt: null,
    })) as ProjectMember['roles'],
    user: {
      id: userId,
      firstName: 'Amina',
      lastName: 'Yusuf',
      email: `${userId}@acco.test`,
      ...user,
    },
  };
}

function orgUser(id: string, first = 'Bashir', last = 'Omar'): OrgUser {
  return {
    id,
    email: `${id}@acco.test`,
    firstName: first,
    lastName: last,
    status: 'ACTIVE',
    organizationId: 'org-1',
  } as OrgUser;
}

const MANAGER = member('m-1', 'u-1', [ProjectRole.PROJECT_MANAGER]);
const ENGINEER = member('m-2', 'u-2', [ProjectRole.SITE_ENGINEER]);

describe('memberName and userName', () => {
  it('joins first and last name', () => {
    expect(memberName(MANAGER)).toBe('Amina Yusuf');
    expect(userName(orgUser('u-9'))).toBe('Bashir Omar');
  });

  it('falls back to the email when the name is blank, rather than rendering a space', () => {
    const nameless = member('m-3', 'u-3', [], { firstName: '', lastName: '' });

    expect(memberName(nameless)).toBe('u-3@acco.test');
    expect(userName(orgUser('u-4', '', ''))).toBe('u-4@acco.test');
  });
});

describe('memberRoles', () => {
  it('returns roles in display order, not the order the API sent them', () => {
    const mixed = member('m-4', 'u-4', [ProjectRole.VIEWER, ProjectRole.PROJECT_MANAGER]);

    expect(memberRoles(mixed)).toEqual([ProjectRole.PROJECT_MANAGER, ProjectRole.VIEWER]);
  });

  it('handles a member with no roles', () => {
    expect(memberRoles(member('m-5', 'u-5', []))).toEqual([]);
  });
});

describe('addableUsers', () => {
  /** Adding an existing member answers 409, so they are filtered rather than offered. */
  it('excludes users who are already members', () => {
    const users = [orgUser('u-1'), orgUser('u-2'), orgUser('u-3')];

    expect(addableUsers(users, [MANAGER, ENGINEER]).map((u) => u.id)).toEqual(['u-3']);
  });

  it('sorts by display name so the picker is stable', () => {
    const users = [orgUser('u-z', 'Zahra'), orgUser('u-a', 'Abdi')];

    expect(addableUsers(users, []).map((u) => u.id)).toEqual(['u-a', 'u-z']);
  });
});

describe('isLastProjectManager', () => {
  it('is true for the only manager', () => {
    expect(isLastProjectManager(MANAGER, [MANAGER, ENGINEER])).toBe(true);
  });

  it('is false when a second manager exists', () => {
    const second = member('m-6', 'u-6', [ProjectRole.PROJECT_MANAGER]);

    expect(isLastProjectManager(MANAGER, [MANAGER, second])).toBe(false);
  });

  it('is false for someone who is not a manager at all', () => {
    expect(isLastProjectManager(ENGINEER, [MANAGER, ENGINEER])).toBe(false);
  });

  it('counts a manager who also holds other roles', () => {
    const dual = member('m-7', 'u-7', [ProjectRole.PROJECT_MANAGER, ProjectRole.VIEWER]);

    expect(isLastProjectManager(dual, [dual, ENGINEER])).toBe(true);
  });
});

describe('removeBlockReason', () => {
  /**
   * Nothing on the server prevents either of these. `removeMember` checks only that the
   * target is an active member — and because `addMember` requires the caller to already be a
   * member, both cases can leave a project that nobody can administer, recoverable only by
   * direct database access.
   */
  it('refuses to remove the last project manager, which the server would allow', () => {
    expect(removeBlockReason(MANAGER, [MANAGER, ENGINEER], 'u-9')).toBe('last-project-manager');
  });

  it('refuses to remove yourself, because you could not add yourself back', () => {
    expect(removeBlockReason(ENGINEER, [MANAGER, ENGINEER], 'u-2')).toBe('self');
  });

  it('reports self before the manager rule, since it is the more immediate objection', () => {
    expect(removeBlockReason(MANAGER, [MANAGER, ENGINEER], 'u-1')).toBe('self');
  });

  it('allows removing anyone else who is not the last manager', () => {
    expect(removeBlockReason(ENGINEER, [MANAGER, ENGINEER], 'u-1')).toBeNull();
  });

  it('does not treat an unknown current user as self', () => {
    expect(removeBlockReason(ENGINEER, [MANAGER, ENGINEER], null)).toBeNull();
  });
});
