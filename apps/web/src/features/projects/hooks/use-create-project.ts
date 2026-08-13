'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { createProject, type CreateProjectPayload } from '../api/projects-api';
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
      router.push(`/projects/${project.id}?created=1`);
    },
  });
}
