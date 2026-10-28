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

// ─── Phone Home: sent back (Step 7) ──────────────────────────────────────
// `GET /procurement/sent-back` — what the signed-in collector was asked to redo, newest first:
// a quotation round returned for more quotes, a quote rejected, a receipt photo rejected.

export type SentBackKind = 'QUOTATION_RETURNED' | 'QUOTE_REJECTED' | 'RECEIPT_REJECTED';

export interface SentBackItem {
  kind: SentBackKind;
  id: string;
  /** The quotation request it belongs to (every item opens there). */
  quotationRequestId: string;
  /** The round's number (QR-…), or the receipt's number (SD-…). */
  number: string;
  /** Who the quote or receipt is from, when known. */
  storeName: string | null;
  /** ILLEGIBLE, WRONG_ITEMS, INCOMPLETE, WRONG_PO, DUPLICATE, OTHER — null for a returned round. */
  reason: string | null;
  note: string | null;
  at: string;
}
