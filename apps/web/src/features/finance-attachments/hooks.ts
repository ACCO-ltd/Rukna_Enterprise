'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FinanceAttachmentKind } from '@erp/types';

import { uploadFile } from '@/features/files/api/files-api';
import { attachFinanceFile, listFinanceAttachments, removeFinanceAttachment } from './api';

export const financeAttachmentKeys = {
  list: (kind: FinanceAttachmentKind, ownerId: string) => ['finance', 'attachments', kind, ownerId] as const,
};

export function useFinanceAttachments(kind: FinanceAttachmentKind, ownerId: string, enabled = true) {
  return useQuery({
    queryKey: financeAttachmentKeys.list(kind, ownerId),
    queryFn: () => listFinanceAttachments(kind, ownerId),
    enabled,
  });
}

/** Upload (presign → PUT → confirm), then attach — one action for the person, two calls underneath. */
export function useAttachFinanceFile(kind: FinanceAttachmentKind, ownerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => attachFinanceFile(kind, ownerId, await uploadFile(file)),
    onSuccess: () => qc.invalidateQueries({ queryKey: financeAttachmentKeys.list(kind, ownerId) }),
  });
}

export function useRemoveFinanceAttachment(kind: FinanceAttachmentKind, ownerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) => removeFinanceAttachment(kind, ownerId, attachmentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: financeAttachmentKeys.list(kind, ownerId) }),
  });
}
