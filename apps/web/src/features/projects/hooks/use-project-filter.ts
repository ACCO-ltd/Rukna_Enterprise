'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

import { useProjects } from './use-projects';

/**
 * The "Project" filter shared by the Accounting lists (flow plan PR 4): the options, and the
 * starting value from `?projectId=` so a project workspace can link into Accounting already
 * narrowed to itself. Filtering happens server-side (`GET /invoices|/bills?projectId=`), which
 * is what lets a supplier bill coded to the project on one line still match.
 */
export function useProjectFilter() {
  const searchParams = useSearchParams();
  const projects = useProjects();
  const options = useMemo(
    () =>
      (projects.data ?? [])
        .map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [projects.data],
  );
  return { initialProjectId: searchParams?.get('projectId') ?? undefined, options };
}
