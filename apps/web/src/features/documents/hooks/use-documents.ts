'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { ProjectDocumentResponse } from '@erp/types';

import {
  attachProjectDocument,
  listProjectDocuments,
  removeProjectDocument,
  type AttachDocumentBody,
} from '../api/documents-api';

export const documentKeys = {
  all: (projectId: string) => ['project-documents', projectId] as const,
  list: (projectId: string) => [...documentKeys.all(projectId), 'list'] as const,
};

export function useProjectDocuments(
  projectId: string,
): UseQueryResult<ProjectDocumentResponse[], Error> {
  return useQuery({
    queryKey: documentKeys.list(projectId),
    queryFn: () => listProjectDocuments(projectId),
    enabled: Boolean(projectId),
  });
}

export function useAttachDocument(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AttachDocumentBody) => attachProjectDocument(projectId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: documentKeys.all(projectId) });
    },
  });
}

export function useRemoveDocument(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => removeProjectDocument(projectId, docId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: documentKeys.all(projectId) });
    },
  });
}
