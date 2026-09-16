-- Commercial round-3: organization invoice branding.
--
-- "Generate invoice" / "Bill this stage" never produced a document — Organization carried no
-- logo, address, tax ID or any branding at all. This adds the settings a professional invoice
-- header/footer needs. All-nullable / defaulted: an org with none of this set still bills fine,
-- it just gets a plain document until someone fills in Settings.
--
-- logo_file_id is optional and ON DELETE SET NULL (not RESTRICT, unlike the required
-- attachment-table FKs elsewhere) — this is a single optional reference on the Organization
-- aggregate itself, not a dedicated attachment row whose entire purpose is the file.

CREATE TYPE "InvoiceTemplate" AS ENUM ('STANDARD', 'COMPACT');

ALTER TABLE "organizations"
  ADD COLUMN "logo_file_id" TEXT,
  ADD COLUMN "legal_address" TEXT,
  ADD COLUMN "tax_registration_number" TEXT,
  ADD COLUMN "brand_color_hex" VARCHAR(9),
  ADD COLUMN "invoice_footer_note" TEXT,
  ADD COLUMN "invoice_template" "InvoiceTemplate" NOT NULL DEFAULT 'STANDARD';

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_logo_file_id_fkey"
  FOREIGN KEY ("logo_file_id") REFERENCES "platform_files"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
