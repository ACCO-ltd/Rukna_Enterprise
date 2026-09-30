'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  LinkedAttachmentListResponse,
  ProjectDocumentCapabilities,
  ProjectDocumentDetailResponse,
  ProjectDocumentListResponse,
} from '@erp/types';

import {
  archiveProjectDocument,
  createDocumentRevision,
  createProjectDocument,
  deleteProjectDocument,
  getDocumentCapabilities,
  getProjectDocument,
  issueDocumentRevision,
  listLinkedAttachments,
  listProjectDocuments,
  replaceRevisionFile,
  supersedeProjectDocument,
  updateProjectDocument,
  withdrawProjectDocument,
  type CreateDocumentBody,
  type CreateRevisionBody,
  type DocumentListFilters,
  type IssueRevisionBody,
  type LinkedAttachmentFilters,
  type UpdateDocumentBody,
} from '../api/documents-api';
import type { MutationFeedbackMeta } from '@/lib/mutation-feedback';

/**
 * Every write returns the whole document detail, and every write invalidates the register.
 *
 * That is deliberate rather than lazy: issuing a revision changes the document's status, its
 * current revision, the previous revision's status, the summary counts and the activity log all at
 * once. Patching a cache entry by hand would be five guesses about what the server did, and the
 * one that drifts is the one nobody notices.
 */
export const documentKeys = {
  all: (projectId: string) => ['project-documents', projectId] as const,
  list: (projectId: string, filters: DocumentListFilters) =>
    [...documentKeys.all(projectId), 'list', filters] as const,
  detail: (projectId: string, documentId: string) =>
    [...documentKeys.all(projectId), 'detail', documentId] as const,
  capabilities: (projectId: string) => [...documentKeys.all(projectId), 'capabilities'] as const,
  attachments: (projectId: string, filters: LinkedAttachmentFilters) =>
    [...documentKeys.all(projectId), 'attachments', filters] as const,
};

export function useProjectDocuments(
  projectId: string,
  filters: DocumentListFilters = {},
): UseQueryResult<ProjectDocumentListResponse, Error> {
  return useQuery({
    queryKey: documentKeys.list(projectId, filters),
    queryFn: () => listProjectDocuments(projectId, filters),
    enabled: Boolean(projectId),
    // The register is a reference someone scans and re-scans while filtering; a flash of empty
    // between pages reads as "there is nothing here", which is a different answer.
    placeholderData: (previous) => previous,
  });
}

export function useProjectDocument(
  projectId: string,
  documentId: string,
): UseQueryResult<ProjectDocumentDetailResponse, Error> {
  return useQuery({
    queryKey: documentKeys.detail(projectId, documentId),
    queryFn: () => getProjectDocument(projectId, documentId),
    enabled: Boolean(projectId && documentId),
  });
}

/**
 * What this caller may do, decided by the server.
 *
 * The browser hides what it is told to hide and never works it out from a permission string of
 * its own: a hidden button and a refused request have to agree, and the only way to guarantee that
 * is for one side to answer the question.
 */
export function useDocumentCapabilities(
  projectId: string,
): UseQueryResult<ProjectDocumentCapabilities, Error> {
  return useQuery({
    queryKey: documentKeys.capabilities(projectId),
    queryFn: () => getDocumentCapabilities(projectId),
    enabled: Boolean(projectId),
  });
}

export function useLinkedAttachments(
  projectId: string,
  filters: LinkedAttachmentFilters = {},
): UseQueryResult<LinkedAttachmentListResponse, Error> {
  return useQuery({
    queryKey: documentKeys.attachments(projectId, filters),
    queryFn: () => listLinkedAttachments(projectId, filters),
    enabled: Boolean(projectId),
    placeholderData: (previous) => previous,
  });
}

/** The toast names the document by its number; every write but delete returns the detail. */
function documentToast(key: string): MutationFeedbackMeta {
  const document = (data: unknown) => (data as ProjectDocumentDetailResponse).document;
  return {
    successToast: { key, values: (data) => ({ ref: document(data).documentNumber }) },
    flashRow: (data) => document(data).id,
  };
}

function useDocumentMutation<TVariables>(
  projectId: string,
  mutationFn: (variables: TVariables) => Promise<unknown>,
  meta: MutationFeedbackMeta,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    meta,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: documentKeys.all(projectId) });
    },
  });
}

export function useCreateDocument(projectId: string) {
  return useDocumentMutation(projectId, (body: CreateDocumentBody) =>
    createProjectDocument(projectId, body),
    documentToast('documents.feedback.registered'),
  );
}

export function useUpdateDocument(projectId: string, documentId: string) {
  return useDocumentMutation(projectId, (body: UpdateDocumentBody) =>
    updateProjectDocument(projectId, documentId, body),
    documentToast('documents.feedback.updated'),
  );
}

export function useCreateRevision(projectId: string, documentId: string) {
  return useDocumentMutation(projectId, (body: CreateRevisionBody) =>
    createDocumentRevision(projectId, documentId, body),
    documentToast('documents.feedback.revisionAdded'),
  );
}

export function useReplaceRevisionFile(projectId: string, documentId: string) {
  return useDocumentMutation(
    projectId,
    ({ revisionId, platformFileId }: { revisionId: string; platformFileId: string }) =>
      replaceRevisionFile(projectId, documentId, revisionId, platformFileId),
    documentToast('documents.feedback.revisionFileReplaced'),
  );
}

export function useIssueRevision(projectId: string, documentId: string) {
  return useDocumentMutation(
    projectId,
    ({ revisionId, ...body }: IssueRevisionBody & { revisionId: string }) =>
      issueDocumentRevision(projectId, documentId, revisionId, body),
    documentToast('documents.feedback.revisionIssued'),
  );
}

export function useWithdrawDocument(projectId: string, documentId: string) {
  return useDocumentMutation(projectId, (reason: string) =>
    withdrawProjectDocument(projectId, documentId, reason),
    documentToast('documents.feedback.withdrawn'),
  );
}

export function useSupersedeDocument(projectId: string, documentId: string) {
  return useDocumentMutation(projectId, (supersededByDocumentId: string) =>
    supersedeProjectDocument(projectId, documentId, supersededByDocumentId),
    documentToast('documents.feedback.superseded'),
  );
}

export function useArchiveDocument(projectId: string, documentId: string) {
  return useDocumentMutation(
    projectId,
    () => archiveProjectDocument(projectId, documentId),
    documentToast('documents.feedback.archived'),
  );
}

export function useDeleteDocument(projectId: string) {
  return useDocumentMutation(projectId, (documentId: string) =>
    deleteProjectDocument(projectId, documentId),
    { successToast: 'documents.feedback.deleted', flashRow: false },
  );
}
