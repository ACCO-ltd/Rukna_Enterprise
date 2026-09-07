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
  /** SHA-256 of the bytes as 64 hex characters. Required — see `sha256Hex`. */
  checksumSha256: string;
}

export interface InitiateUploadResponse {
  fileId: string;
  /**
   * Short-lived (15 min) presigned PUT URL. Signed with the mimeType AND the checksum, so both
   * headers must be sent exactly — see uploadFile.
   */
  uploadUrl: string;
  checksumSha256: string;
}

export interface PlatformFileRecord {
  id: string;
  organizationId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: 'PENDING' | 'READY';
  /** TEMPORARY until a record attaches it; IMMUTABLE once that record finalises. */
  lifecycle: 'TEMPORARY' | 'BOUND' | 'IMMUTABLE';
  checksumSha256: string | null;
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

/**
 * Discard an abandoned upload. Rejected (403) once anything owns the file: a bound file is
 * removed by detaching it from its record, and a file on a finalised record is never removed.
 */
export function deleteFile(fileId: string): Promise<void> {
  return apiClient<void>(`/files/${fileId}`, { method: 'DELETE' });
}

/**
 * SHA-256 of a file, as lower-case hex.
 *
 * Computed in the browser before the upload starts, because the API signs the presigned PUT with
 * it — object storage then rejects a body that does not hash to it, which is what makes the
 * integrity record a control rather than a claim. `crypto.subtle` needs a secure context; the app
 * is served over HTTPS everywhere except localhost, which browsers already treat as secure.
 */
export async function sha256Hex(file: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure file upload is unavailable in this browser context.');
  }
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Full upload flow in one call: hash → presign → PUT bytes to storage → confirm READY. Returns
 * the `fileId`, ready to attach to a Document or DPR evidence.
 *
 * The PUT goes DIRECTLY to object storage (not through `apiClient`) — no auth header — and every
 * header the URL was signed with must be reproduced exactly or the signature fails with 403:
 *
 * - `Content-Type` must equal the mimeType sent to `initiateUpload`;
 * - `x-amz-checksum-sha256` must be the same digest, base64-encoded rather than hex, because that
 *   is the encoding S3 signs. Storage verifies the body against it and rejects a mismatch, so a
 *   truncated or corrupted upload fails here rather than being confirmed as good.
 */
export async function uploadFile(file: File): Promise<string> {
  const mimeType = file.type || 'application/octet-stream';
  const checksumSha256 = await sha256Hex(file);

  const { fileId, uploadUrl } = await initiateUpload({
    originalName: file.name,
    mimeType,
    checksumSha256,
  });

  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'x-amz-checksum-sha256': hexToBase64(checksumSha256),
    },
    body: file,
  });
  if (!put.ok) {
    throw new Error(`File upload failed (${put.status})`);
  }

  await confirmUpload(fileId, { checksumSha256 });
  return fileId;
}

/** S3 signs the checksum header base64-encoded; the platform stores and sends hex. */
function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
