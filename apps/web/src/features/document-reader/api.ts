'use client';

import { useQuery } from '@tanstack/react-query';
import type { DocumentReadResult, DocumentReaderStatus, DocumentReadingKind } from '@erp/types';

import { apiClient } from '@/lib/api-client';

/** Step 7 — the photo reader (`/document-reader`). */
export const documentReaderApi = {
  status: () => apiClient<DocumentReaderStatus>('/document-reader/status'),
  setEnabled: (enabled: boolean) => apiClient<DocumentReaderStatus>('/document-reader/settings', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  read: (platformFileId: string, kind: DocumentReadingKind) =>
    apiClient<DocumentReadResult>('/document-reader/read', { method: 'POST', body: JSON.stringify({ platformFileId, kind }) }),
};

export const readerStatusKey = ['document-reader', 'status'] as const;

/** Whether to offer "Read the photo": the server has a reader and the company turned it on. */
export function useDocumentReader() {
  const status = useQuery({ queryKey: readerStatusKey, queryFn: documentReaderApi.status, staleTime: 5 * 60_000 });
  return { status: status.data, ready: Boolean(status.data?.available && status.data.enabled) };
}
