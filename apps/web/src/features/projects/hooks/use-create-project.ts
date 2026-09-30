'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { createProject, type CreateProjectPayload } from '../api/projects-api';
import type { Project } from '../types';
import { projectKeys } from './use-projects';

export function useCreateProject() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateProjectPayload) => createProject(payload),
    onSuccess: async (project) => {
      // The list and the dashboard counts both read the same query — invalidate once and
      // both are correct. Awaited so the list is fresh before we navigate onto it.
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      router.push(`/projects/${project.id}`);
    },
    // Raised after the navigation above, by the app-level toast, so it lands on the new
    // project's page.
    meta: {
      successToast: {
        key: 'platform.feedback.projectCreated',
        values: (data) => ({ code: (data as Project).code }),
      },
    },
  });
}
