import type { UserWithRolesResponse } from '@erp/types';
import { UserStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { bulkTargets, filterUsers } from './filter-users';

function user(
  overrides: Partial<UserWithRolesResponse> & { id: string },
): UserWithRolesResponse {
  return {
    email: 'amina@acco.so',
    firstName: 'Amina',
    lastName: 'Yusuf',
    status: UserStatus.ACTIVE,
    membershipStatus: null,
    roles: [],
    ...overrides,
  };
}

describe('filterUsers', () => {
  it('returns everything when nothing is filtered', () => {
    const users = [user({ id: 'a' }), user({ id: 'b' })];
    expect(filterUsers(users, '', 'ALL')).toHaveLength(2);
  });

  it('filters by status', () => {
    const users = [
      user({ id: 'a', status: UserStatus.ACTIVE }),
      user({ id: 'b', status: UserStatus.INACTIVE }),
    ];
    expect(filterUsers(users, '', UserStatus.INACTIVE)).toEqual([users[1]]);
  });

  it('matches on first name, last name, or email, case-insensitively', () => {
    const users = [
      user({ id: 'a', firstName: 'Kofi', lastName: 'Osei', email: 'kofi@acco.so' }),
      user({ id: 'b', firstName: 'Mira', lastName: 'Chen', email: 'mira@acco.so' }),
    ];
    expect(filterUsers(users, 'kofi', 'ALL')).toEqual([users[0]]);
    expect(filterUsers(users, 'CHEN', 'ALL')).toEqual([users[1]]);
    expect(filterUsers(users, 'mira@acco', 'ALL')).toEqual([users[1]]);
  });

  it('combines search and status', () => {
    const users = [
      user({ id: 'a', firstName: 'Kofi', status: UserStatus.ACTIVE }),
      user({ id: 'b', firstName: 'Kofi', status: UserStatus.INACTIVE }),
    ];
    expect(filterUsers(users, 'kofi', UserStatus.INACTIVE)).toEqual([users[1]]);
  });
});

describe('bulkTargets', () => {
  it('deactivate: only active users, excluding the current user own row', () => {
    const selected = [
      user({ id: 'me', status: UserStatus.ACTIVE }),
      user({ id: 'kofi', status: UserStatus.ACTIVE }),
      user({ id: 'mira', status: UserStatus.INACTIVE }),
    ];
    // The API rejects self-deactivation; the own row is never a bulk-deactivate target.
    expect(bulkTargets(selected, 'deactivate', 'me')).toEqual(['kofi']);
  });

  it('deactivate: with no current user still excludes already-inactive rows', () => {
    const selected = [
      user({ id: 'kofi', status: UserStatus.ACTIVE }),
      user({ id: 'mira', status: UserStatus.INACTIVE }),
    ];
    expect(bulkTargets(selected, 'deactivate', null)).toEqual(['kofi']);
  });

  it('reactivate: only non-active users, and does NOT exclude the current user', () => {
    const selected = [
      user({ id: 'me', status: UserStatus.INACTIVE }),
      user({ id: 'kofi', status: UserStatus.ACTIVE }),
    ];
    // Reactivating yourself is legitimate; self-exclusion is a deactivation rule only.
    expect(bulkTargets(selected, 'reactivate', 'me')).toEqual(['me']);
  });

  it('yields no targets when the selection has nothing eligible', () => {
    const selected = [user({ id: 'me', status: UserStatus.ACTIVE })];
    expect(bulkTargets(selected, 'deactivate', 'me')).toEqual([]);
  });
});
