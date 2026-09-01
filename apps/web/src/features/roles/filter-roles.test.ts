import type { RoleSummary } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { filterRoles } from './filter-roles';

function role(overrides: Partial<RoleSummary> & { id: string }): RoleSummary {
  return {
    name: 'Finance',
    description: null,
    kind: 'CUSTOM',
    purpose: null,
    ownerUserId: null,
    templateRoleId: null,
    permissionCount: 0,
    memberCount: 0,
    ...overrides,
  };
}

describe('filterRoles', () => {
  it('returns everything when nothing is filtered', () => {
    const roles = [role({ id: 'a' }), role({ id: 'b' })];
    expect(filterRoles(roles, '', 'ALL')).toHaveLength(2);
  });

  it('filters by kind', () => {
    const roles = [
      role({ id: 'a', kind: 'SYSTEM' }),
      role({ id: 'b', kind: 'CUSTOM' }),
    ];
    expect(filterRoles(roles, '', 'SYSTEM')).toEqual([roles[0]]);
    expect(filterRoles(roles, '', 'CUSTOM')).toEqual([roles[1]]);
  });

  it('matches on name, case-insensitively', () => {
    const roles = [
      role({ id: 'a', name: 'Admin' }),
      role({ id: 'b', name: 'Procurement' }),
    ];
    expect(filterRoles(roles, 'admin', 'ALL')).toEqual([roles[0]]);
    expect(filterRoles(roles, 'PROC', 'ALL')).toEqual([roles[1]]);
  });

  it('combines search and kind', () => {
    const roles = [
      role({ id: 'a', name: 'Admin', kind: 'SYSTEM' }),
      role({ id: 'b', name: 'Admin assistant', kind: 'CUSTOM' }),
    ];
    expect(filterRoles(roles, 'admin', 'CUSTOM')).toEqual([roles[1]]);
  });
});
