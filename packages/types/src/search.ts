// ─── Record search (⌘K, Step 2f, ADR-047) ─────────────────────────────────
// `GET /search?q=` — each group only for a caller who may read that list, and projects only those
// the caller can reach (project membership, as every project read).

export type SearchRecordKind = 'INVOICE' | 'BILL' | 'PAYMENT' | 'RECEIPT' | 'JOURNAL' | 'PROJECT' | 'CLIENT' | 'SUPPLIER';

export interface SearchRecord {
  kind: SearchRecordKind;
  id: string;
  /** The record's reference or name, e.g. "INV-000118" or "Hargeisa Water Agency". */
  title: string;
  /** One quiet line: who, what, when. */
  detail: string | null;
  /** Decimal string, when the record carries money. */
  amount: string | null;
  currencyCode: string | null;
  /** The stored status, for the reader's context ("POSTED", "ACTIVE"). */
  status: string | null;
  /** For actions on a client: invoice or receive from them. */
  clientId: string | null;
}

export interface SearchResponse {
  query: string;
  records: SearchRecord[];
}
