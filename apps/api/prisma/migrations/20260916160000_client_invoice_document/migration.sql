-- Commercial round-3: the rendered branded invoice PDF.
--
-- Generated lazily on first request (ClientInvoiceService.getOrGenerateDocument), never eagerly
-- at each of the four invoice-creation paths — one nullable column and one lazy code path covers
-- IPC, installment, separate-charge and VO-standalone invoices alike, with nothing to keep in
-- sync across them. ON DELETE SET NULL for the same reason as organizations.logo_file_id: this is
-- an optional reference on the invoice aggregate itself, not a required attachment row.

ALTER TABLE "client_invoices" ADD COLUMN "document_file_id" TEXT;

ALTER TABLE "client_invoices"
  ADD CONSTRAINT "client_invoices_document_file_id_fkey"
  FOREIGN KEY ("document_file_id") REFERENCES "platform_files"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
