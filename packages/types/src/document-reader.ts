/**
 * Step 7 — the photo reader (`/document-reader`). It reads a photo the user already uploaded and
 * returns what it found, to pre-fill a form. It never saves anything: a person checks and
 * confirms every field. Amounts and quantities are decimal strings exactly as read.
 */
export type DocumentReadingKind = 'DELIVERY_NOTE' | 'RECEIPT' | 'QUOTE' | 'MATERIAL_LIST';

export interface DocumentReaderStatus {
  /** The server has a reader configured (provider and key). */
  available: boolean;
  /** An administrator has turned the reader on for this company. */
  enabled: boolean;
  /** Who the photos go to, for the settings screen's note, e.g. "OpenRouter". */
  provider: string | null;
  model: string | null;
}

export interface ReadLine {
  description: string;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  amount: string | null;
}

export interface DocumentReadResult {
  readingId: string;
  kind: DocumentReadingKind;
  supplierName: string | null;
  documentNumber: string | null;
  /** YYYY-MM-DD, or null when no date could be read. */
  date: string | null;
  currency: string | null;
  total: string | null;
  taxAmount: string | null;
  lines: ReadLine[];
  /** Things a person should look at: "The total does not equal the sum of the lines". */
  warnings: string[];
}

export interface ReadDocumentRequest {
  platformFileId: string;
  kind: DocumentReadingKind;
}
