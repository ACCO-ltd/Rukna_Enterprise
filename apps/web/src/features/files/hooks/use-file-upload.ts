'use client';

import { useMutation } from '@tanstack/react-query';

import { uploadFile } from '../api/files-api';

/**
 * Uploads a file through the full presign → PUT → confirm flow and resolves the `fileId`.
 *
 * Deliberately does not touch any query cache — a raw file has no list of its own; it only
 * matters once attached. Chain it into an attach mutation (documents or DPR evidence):
 *
 *   const upload = useFileUpload();
 *   const attach = useAttachDocument(projectId);
 *   const fileId = await upload.mutateAsync(file);
 *   await attach.mutateAsync({ platformFileId: fileId, category, title });
 */
export function useFileUpload() {
  return useMutation({
    mutationFn: (file: File) => uploadFile(file),
  });
}
