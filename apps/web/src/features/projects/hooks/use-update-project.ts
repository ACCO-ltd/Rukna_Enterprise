'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { updateProject, type UpdateProjectPayload } from '../api/projects-api';
import type { Project } from '../types';
import { projectKeys } from './use-projects';

export function useUpdateProject(id: string) {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateProjectPayload) => updateProject(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      router.push(`/projects/${id}`);
    },
    meta: {
      successToast: {
        key: 'platform.feedback.projectUpdated',
        values: (data) => ({ code: (data as Project).code }),
      },
    },
  });
}
