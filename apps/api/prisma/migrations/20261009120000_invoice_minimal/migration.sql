-- Minimal invoice layout (owner mock): a tagline under the logo, a footer contact strip (address,
-- up to two phones, email, website) and switches for the optional Bank Account Details and Notes
-- sections. Both switches start OFF for every organisation, existing settings included.
ALTER TABLE "invoice_document_policy"
    ADD COLUMN "tagline" VARCHAR(80),
    ADD COLUMN "footer_address" TEXT,
    ADD COLUMN "footer_phones" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "footer_email" VARCHAR(254),
    ADD COLUMN "footer_website" VARCHAR(200),
    ADD COLUMN "show_bank_details" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "show_notes" BOOLEAN NOT NULL DEFAULT false;
