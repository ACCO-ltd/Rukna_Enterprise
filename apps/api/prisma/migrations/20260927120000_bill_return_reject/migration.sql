-- ADR-037 amendment (2026-09-27): a submitted supplier bill can be returned for correction
-- (back to DRAFT, with a reason) or rejected (final, with a reason).

ALTER TABLE "supplier_bills"
  ADD COLUMN "returned_at" TIMESTAMP(3),
  ADD COLUMN "returned_by" TEXT,
  ADD COLUMN "return_reason" TEXT,
  ADD COLUMN "rejected_at" TIMESTAMP(3),
  ADD COLUMN "rejected_by" TEXT,
  ADD COLUMN "rejection_reason" TEXT;

-- One LIVE bill per supplier invoice number. A rejected (or cancelled) bill no longer holds its
-- number, so the corrected bill can be entered. Prisma cannot express a partial index; the
-- schema keeps a plain lookup index and documents this one.
DROP INDEX "supplier_bills_organization_id_supplier_id_supplier_invoice_key";

CREATE INDEX "supplier_bills_organization_id_supplier_id_supplier_invoice_idx"
  ON "supplier_bills"("organization_id", "supplier_id", "supplier_invoice_number_norm");

CREATE UNIQUE INDEX "supplier_bills_live_supplier_invoice_number_key"
  ON "supplier_bills"("organization_id", "supplier_id", "supplier_invoice_number_norm")
  WHERE "document_status" NOT IN ('REJECTED', 'CANCELLED');
