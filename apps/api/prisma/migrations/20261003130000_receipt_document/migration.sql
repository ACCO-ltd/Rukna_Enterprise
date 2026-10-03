-- WhatsApp V1 step 3: the rendered branded receipt PDF.
--
-- Generated lazily on first request for a POSTED receipt (PaymentReceiptDocumentService), bound by
-- compare-and-set and then frozen (IMMUTABLE) — the same pattern as client_invoices.document_file_id
-- (migration 20260916160000_client_invoice_document). ON DELETE SET NULL for the same reason: an
-- optional reference on the receipt aggregate itself, not a required attachment row.

ALTER TABLE "payment_receipts" ADD COLUMN "document_file_id" TEXT;

ALTER TABLE "payment_receipts"
  ADD CONSTRAINT "payment_receipts_document_file_id_fkey"
  FOREIGN KEY ("document_file_id") REFERENCES "platform_files"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
