import { ProjectStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import type { Project } from '@/features/projects/types';

import { summarizeProjects } from './summarize-projects';

function project(overrides: Partial<Project> & { id: string }): Project {
  return {
    organizationId: 'org-1',
    code: `ACCO-${overrides.id}`,
    name: `Project ${overrides.id}`,
    nameAr: null,
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

describe('summarizeProjects', () => {
  it('reports an empty portfolio', () => {
    const summary = summarizeProjects([]);

    expect(summary.total).toBe(0);
    expect(summary.statusCounts).toEqual([]);
    expect(summary.recent).toEqual([]);
  });

  it('counts projects per status', () => {
    const summary = summarizeProjects([
      project({ id: '1', status: ProjectStatus.ACTIVE }),
      project({ id: '2', status: ProjectStatus.ACTIVE }),
      project({ id: '3', status: ProjectStatus.DRAFT }),
    ]);

    expect(summary.total).toBe(3);
    expect(summary.statusCounts).toEqual([
      { status: ProjectStatus.DRAFT, count: 1 },
      { status: ProjectStatus.ACTIVE, count: 2 },
    ]);
  });

  // A row of eight tiles, six of them zero, describes the enum rather than the portfolio.
  it('omits statuses with no projects', () => {
    const summary = summarizeProjects([project({ id: '1', status: ProjectStatus.ACTIVE })]);

    expect(summary.statusCounts).toHaveLength(1);
    expect(summary.statusCounts[0]?.status).toBe(ProjectStatus.ACTIVE);
  });

  it('orders statuses by lifecycle, not by first appearance', () => {
    const summary = summarizeProjects([
      project({ id: '1', status: ProjectStatus.CLOSED }),
      project({ id: '2', status: ProjectStatus.DRAFT }),
      project({ id: '3', status: ProjectStatus.ACTIVE }),
    ]);

    expect(summary.statusCounts.map((s) => s.status)).toEqual([
      ProjectStatus.DRAFT,
      ProjectStatus.ACTIVE,
      ProjectStatus.CLOSED,
    ]);
  });

  it('sorts recent projects newest first regardless of API order', () => {
    const summary = summarizeProjects([
      project({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
      project({ id: 'new', createdAt: '2026-08-01T00:00:00.000Z' }),
      project({ id: 'mid', createdAt: '2026-04-01T00:00:00.000Z' }),
    ]);

    expect(summary.recent.map((p) => p.id)).toEqual(['new', 'mid', 'old']);
  });

  it('caps the recent list at five', () => {
    const summary = summarizeProjects(
      Array.from({ length: 9 }, (_, i) =>
        project({ id: String(i), createdAt: `2026-0${String(i + 1)}-01T00:00:00.000Z` }),
      ),
    );

    expect(summary.recent).toHaveLength(5);
    expect(summary.total).toBe(9);
  });

  it('does not mutate the array it is given', () => {
    const projects = [
      project({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
      project({ id: 'new', createdAt: '2026-08-01T00:00:00.000Z' }),
    ];

    summarizeProjects(projects);

    expect(projects.map((p) => p.id)).toEqual(['old', 'new']);
  });
});
