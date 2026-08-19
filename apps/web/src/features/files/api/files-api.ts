import { apiClient } from '@/lib/api-client';

/**
 * Platform file storage (ADR-014). Two-step upload: presign → PUT the bytes straight to
 * object storage → confirm. The API only ever holds metadata; the bytes never pass through it.
 *
 * These envelope shapes are NOT in `@erp/types` — the controller returns ad-hoc objects — so
 * they are declared here. If the backend later publishes shared file types, replace these.
 */

export interface InitiateUploadBody {
  originalName: string;
  mimeType: string;
}

export interface InitiateUploadResponse {
  fileId: string;
  /** Short-lived (15 min) presigned PUT URL. Signed WITH the mimeType — see uploadFile. */
  uploadUrl: string;
}

export interface PlatformFileRecord {
  id: string;
  organizationId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: 'PENDING' | 'READY';
  createdAt: string;
}

export interface DownloadUrlResponse {
  /** Short-lived signed GET URL. Fetch on demand; do not cache — it expires (~15 min). */
  url: string;
  originalName: string;
  mimeType: string;
}

/** Step 1: create the metadata row and get a presigned upload URL. */
export function initiateUpload(body: InitiateUploadBody): Promise<InitiateUploadResponse> {
  return apiClient<InitiateUploadResponse>('/files', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Step 3: after the bytes are uploaded, verify the object exists and mark the file READY. */
export function confirmUpload(
  fileId: string,
  body: { checksumSha256?: string } = {},
): Promise<PlatformFileRecord> {
  return apiClient<PlatformFileRecord>(`/files/${fileId}/confirm`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** A short-lived signed URL to download/open the file. */
export function getFileDownloadUrl(fileId: string): Promise<DownloadUrlResponse> {
  return apiClient<DownloadUrlResponse>(`/files/${fileId}/download`);
}

/** Delete a file. Rejected (400) once the file is immutable / audit-relevant. */
export function deleteFile(fileId: string): Promise<void> {
  return apiClient<void>(`/files/${fileId}`, { method: 'DELETE' });
}

/**
 * Full upload flow in one call: presign → PUT bytes to storage → confirm READY. Returns the
 * `fileId`, ready to attach to a Document or DPR evidence.
 *
 * The PUT goes DIRECTLY to object storage (not through `apiClient`) — no auth header, and the
 * `Content-Type` MUST equal the mimeType we presigned with, because the presigned URL is signed
 * with `ContentType`. A mismatched header makes S3 reject the signature with 403.
 */
export async function uploadFile(file: File): Promise<string> {
  const mimeType = file.type || 'application/octet-stream';
  const { fileId, uploadUrl } = await initiateUpload({ originalName: file.name, mimeType });

  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: file,
  });
  if (!put.ok) {
    throw new Error(`File upload failed (${put.status})`);
  }

  await confirmUpload(fileId);
  return fileId;
}
