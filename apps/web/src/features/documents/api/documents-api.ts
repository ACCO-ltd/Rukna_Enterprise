import type { DocumentCategory, ProjectDocumentResponse } from '@erp/types';

import { apiClient } from '@/lib/api-client';

/**
 * Project document register (Documents tab). Standalone permits / drawings / licences held on a
 * PlatformFile. Upload the bytes with `uploadFile` (files-api) FIRST, then attach the READY
 * `fileId` here. The list response nests `platformFile` (name, mime, size, status) so it renders
 * without a second call — resolve a signed URL via `getFileDownloadUrl` only when the user opens it.
 */

export interface AttachDocumentBody {
  /** A confirmed (READY) PlatformFile id. */
  platformFileId: string;
  category: DocumentCategory;
  title: string;
}

export function listProjectDocuments(projectId: string): Promise<ProjectDocumentResponse[]> {
  return apiClient<ProjectDocumentResponse[]>(`/projects/${projectId}/documents`);
}

export function attachProjectDocument(
  projectId: string,
  body: AttachDocumentBody,
): Promise<ProjectDocumentResponse> {
  return apiClient<ProjectDocumentResponse>(`/projects/${projectId}/documents`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function removeProjectDocument(projectId: string, docId: string): Promise<void> {
  return apiClient<void>(`/projects/${projectId}/documents/${docId}`, { method: 'DELETE' });
}
