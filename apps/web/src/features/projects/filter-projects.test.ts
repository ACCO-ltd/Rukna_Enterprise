import { ProjectStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { filterProjects } from './filter-projects';
import type { Project } from './types';

function project(overrides: Partial<Project> & { id: string }): Project {
  return {
    organizationId: 'org-1',
    code: `ACCO-${overrides.id}`,
    name: `Project ${overrides.id}`,
    description: null,
    status: ProjectStatus.DRAFT,
    contractValue: null,
    currency: null,
    clientName: null,
    startDate: null,
    expectedEndDate: null,
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const projects = [
  project({ id: '1', code: 'ACCO-2026-001', name: 'Al-Baraka Tower', status: ProjectStatus.ACTIVE }),
  project({
    id: '2',
    code: 'ACCO-2026-002',
    name: 'Marina Residences',
    clientName: 'Gulf Estates',
    status: ProjectStatus.DRAFT,
  }),
  project({ id: '3', code: 'ACCO-2025-009', name: 'Airport Hangar', status: ProjectStatus.CLOSED }),
];

describe('filterProjects', () => {
  it('returns everything when unfiltered', () => {
    expect(filterProjects(projects, { search: '', status: 'ALL' })).toHaveLength(3);
  });

  it('filters by status', () => {
    const result = filterProjects(projects, { search: '', status: ProjectStatus.ACTIVE });

    expect(result.map((p) => p.id)).toEqual(['1']);
  });

  it('matches on code', () => {
    expect(filterProjects(projects, { search: '2025', status: 'ALL' }).map((p) => p.id)).toEqual([
      '3',
    ]);
  });

  it('matches on name, case-insensitively', () => {
    expect(filterProjects(projects, { search: 'baraka', status: 'ALL' }).map((p) => p.id)).toEqual([
      '1',
    ]);
  });

  it('matches on client name', () => {
    expect(filterProjects(projects, { search: 'gulf', status: 'ALL' }).map((p) => p.id)).toEqual([
      '2',
    ]);
  });

  // An Arabic-named project must be findable while the interface is in English.

  it('ignores surrounding whitespace in the search term', () => {
    expect(filterProjects(projects, { search: '  baraka  ', status: 'ALL' })).toHaveLength(1);
  });

  it('applies search and status together', () => {
    expect(
      filterProjects(projects, { search: 'ACCO', status: ProjectStatus.CLOSED }).map((p) => p.id),
    ).toEqual(['3']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterProjects(projects, { search: 'nonexistent', status: 'ALL' })).toEqual([]);
  });

  it('tolerates a project with null optional fields', () => {
    expect(filterProjects([project({ id: 'x' })], { search: 'zzz', status: 'ALL' })).toEqual([]);
  });
});
