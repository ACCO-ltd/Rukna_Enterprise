/** Step 4 — a file attached to a finance document (GET/POST /finance/attachments/:kind/:ownerId). */
export type FinanceAttachmentKind = 'INVOICE' | 'RECEIPT' | 'BILL' | 'PAYMENT' | 'JOURNAL';

export interface FinanceAttachment {
  id: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Added after the document posted: supplementary evidence, kept for good. */
  addedAfterPosting: boolean;
  /** The document is posted, so this file can no longer be removed. */
  locked: boolean;
  createdBy: string;
  createdAt: string;
}
