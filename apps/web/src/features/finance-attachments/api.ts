import { apiClient } from '@/lib/api-client';
import type { FinanceAttachment, FinanceAttachmentKind } from '@erp/types';

const base = (kind: FinanceAttachmentKind, ownerId: string) =>
  `/finance/attachments/${kind}/${encodeURIComponent(ownerId)}`;

/** Step 4 — `GET /finance/attachments/:kind/:ownerId`. */
export function listFinanceAttachments(kind: FinanceAttachmentKind, ownerId: string): Promise<FinanceAttachment[]> {
  return apiClient<FinanceAttachment[]>(base(kind, ownerId));
}

export function attachFinanceFile(
  kind: FinanceAttachmentKind,
  ownerId: string,
  platformFileId: string,
): Promise<FinanceAttachment> {
  return apiClient<FinanceAttachment>(base(kind, ownerId), { method: 'POST', body: JSON.stringify({ platformFileId }) });
}

export function removeFinanceAttachment(kind: FinanceAttachmentKind, ownerId: string, attachmentId: string): Promise<void> {
  return apiClient<void>(`${base(kind, ownerId)}/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' });
}
