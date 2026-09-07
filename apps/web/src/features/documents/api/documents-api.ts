import type {
  DocumentCategory,
  DocumentDiscipline,
  DocumentRevisionPurpose,
  LinkedAttachmentListResponse,
  ProjectDocumentCapabilities,
  ProjectDocumentDetailResponse,
  ProjectDocumentListResponse,
  ProjectDocumentStatus,
} from '@erp/types';

import { apiClient } from '@/lib/api-client';

/**
 * The controlled project document register.
 *
 * Two surfaces behind one prefix, answering two different questions:
 *
 *   /documents              what controlled documents is this project accountable for?
 *   /documents/attachments  what evidence exists across the project, and where does it belong?
 *
 * The register is a real aggregate with a lifecycle; Linked Attachments is a read-only view over
 * files that other records own. The second has no create, update or delete on purpose — mutations
 * go through the owning record so its own rules run.
 *
 * Upload flow is unchanged: `uploadFile` (files-api) first, then pass the READY `platformFileId`
 * here. Uploading is never issuance.
 */

export interface CreateDocumentBody {
  documentNumber: string;
  title: string;
  category: DocumentCategory;
  discipline?: DocumentDiscipline;
  responsibleUserId?: string;
  issuerName?: string;
  issuedAt?: string;
  validFrom?: string;
  expiresAt?: string;
  /** A confirmed (READY) PlatformFile id — becomes revision 1. */
  platformFileId: string;
  revisionCode?: string;
  purpose?: DocumentRevisionPurpose;
  notes?: string;
}

/**
 * `null` clears a field; omitting it leaves the field alone. The two are different edits and the
 * server distinguishes them, so the form must not collapse them either.
 */
export interface UpdateDocumentBody {
  documentNumber?: string;
  title?: string;
  category?: DocumentCategory;
  discipline?: DocumentDiscipline | null;
  responsibleUserId?: string | null;
  issuerName?: string | null;
  issuedAt?: string | null;
  validFrom?: string | null;
  expiresAt?: string | null;
}

export interface CreateRevisionBody {
  platformFileId: string;
  revisionCode?: string;
  purpose?: DocumentRevisionPurpose;
  notes?: string;
}

export interface IssueRevisionBody {
  issuedAt?: string;
  revisionCode?: string;
  purpose?: DocumentRevisionPurpose;
}

export interface DocumentListFilters {
  [key: string]: string | number | undefined;
  search?: string;
  category?: DocumentCategory | '';
  discipline?: DocumentDiscipline | '';
  status?: ProjectDocumentStatus | '';
  validity?: string;
  responsibleUserId?: string;
  page?: number;
  pageSize?: number;
}

function toQuery(filters: Record<string, string | number | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function listProjectDocuments(
  projectId: string,
  filters: DocumentListFilters = {},
): Promise<ProjectDocumentListResponse> {
  return apiClient<ProjectDocumentListResponse>(
    `/projects/${projectId}/documents${toQuery(filters)}`,
  );
}

export function getProjectDocument(
  projectId: string,
  documentId: string,
): Promise<ProjectDocumentDetailResponse> {
  return apiClient<ProjectDocumentDetailResponse>(`/projects/${projectId}/documents/${documentId}`);
}

export function getDocumentCapabilities(
  projectId: string,
): Promise<ProjectDocumentCapabilities> {
  return apiClient<ProjectDocumentCapabilities>(`/projects/${projectId}/documents/capabilities`);
}

export function createProjectDocument(
  projectId: string,
  body: CreateDocumentBody,
): Promise<ProjectDocumentDetailResponse> {
  return apiClient<ProjectDocumentDetailResponse>(`/projects/${projectId}/documents`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateProjectDocument(
  projectId: string,
  documentId: string,
  body: UpdateDocumentBody,
): Promise<ProjectDocumentDetailResponse> {
  return apiClient<ProjectDocumentDetailResponse>(
    `/projects/${projectId}/documents/${documentId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
}

export function createDocumentRevision(
  projectId: string,
  documentId: string,
  body: CreateRevisionBody,
): Promise<ProjectDocumentDetailResponse> {
  return apiClient<ProjectDocumentDetailResponse>(
    `/projects/${projectId}/documents/${documentId}/revisions`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** Draft revisions only — an issued revision's file is immutable at the storage layer too. */
export function replaceRevisionFile(
  projectId: string,
  documentId: string,
  revisionId: string,
  platformFileId: string,
): Promise<ProjectDocumentDetailResponse> {
  return apiClient<ProjectDocumentDetailResponse>(
    `/projects/${projectId}/documents/${documentId}/revisions/${revisionId}/file`,
    { method: 'PATCH', body: JSON.stringify({ platformFileId }) },
  );
}

export function issueDocumentRevision(
  projectId: string,
  documentId: string,
  revisionId: string,
  body: IssueRevisionBody = {},
): Promise<ProjectDocumentDetailResponse> {
  return apiClient<ProjectDocumentDetailResponse>(
    `/projects/${projectId}/documents/${documentId}/revisions/${revisionId}/issue`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function withdrawProjectDocument(
  projectId: string,
  documentId: string,
  reason: string,
): Promise<ProjectDocumentDetailResponse> {
  return apiClient<ProjectDocumentDetailResponse>(
    `/projects/${projectId}/documents/${documentId}/withdraw`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  );
}

export function supersedeProjectDocument(
  projectId: string,
  documentId: string,
  supersededByDocumentId: string,
): Promise<ProjectDocumentDetailResponse> {
  return apiClient<ProjectDocumentDetailResponse>(
    `/projects/${projectId}/documents/${documentId}/supersede`,
    { method: 'POST', body: JSON.stringify({ supersededByDocumentId }) },
  );
}

export function archiveProjectDocument(
  projectId: string,
  documentId: string,
): Promise<ProjectDocumentDetailResponse> {
  return apiClient<ProjectDocumentDetailResponse>(
    `/projects/${projectId}/documents/${documentId}/archive`,
    { method: 'POST' },
  );
}

/** Only ever reaches a draft with no issued history — the server refuses anything else. */
export function deleteProjectDocument(projectId: string, documentId: string): Promise<void> {
  return apiClient<void>(`/projects/${projectId}/documents/${documentId}`, { method: 'DELETE' });
}

export interface LinkedAttachmentFilters {
  [key: string]: string | number | undefined;
  sourceType?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function listLinkedAttachments(
  projectId: string,
  filters: LinkedAttachmentFilters = {},
): Promise<LinkedAttachmentListResponse> {
  return apiClient<LinkedAttachmentListResponse>(
    `/projects/${projectId}/documents/attachments${toQuery(filters)}`,
  );
}
