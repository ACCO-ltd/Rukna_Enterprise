import type { ProjectStatus } from '@erp/types';

import { PROJECT_STATUS_ORDER, type Project } from '@/features/projects/types';

export interface StatusCount {
  status: ProjectStatus;
  count: number;
}

export interface ProjectSummary {
  total: number;
  /** Only statuses with at least one project, in lifecycle order. */
  statusCounts: StatusCount[];
  /** Most recently created projects, newest first. */
  recent: Project[];
}

const RECENT_LIMIT = 5;

/**
 * Aggregates the project list for the dashboard.
 *
 * Everything here is derived from data already on screen elsewhere — no invented metrics.
 * Budget utilisation, cost variance and earned value would all need endpoints that do not
 * exist, and a plausible-looking wrong number on a dashboard is worse than no number.
 *
 * Statuses with a zero count are omitted rather than rendered as empty tiles, so the row
 * reflects the portfolio instead of the enum.
 */
export function summarizeProjects(projects: Project[]): ProjectSummary {
  const counts = new Map<ProjectStatus, number>();

  for (const project of projects) {
    counts.set(project.status, (counts.get(project.status) ?? 0) + 1);
  }

  const statusCounts = PROJECT_STATUS_ORDER.filter((status) => counts.has(status)).map(
    (status) => ({ status, count: counts.get(status) ?? 0 }),
  );

  // The API already returns newest-first, but the dashboard should not silently depend on
  // an undocumented ordering — sort explicitly.
  const recent = [...projects]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, RECENT_LIMIT);

  return { total: projects.length, statusCounts, recent };
}
