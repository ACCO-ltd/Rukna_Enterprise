-- Slice 4B: invoice notes field + delivery history.
--
-- Safe forward migration — every DDL statement is idempotent:
--   • ADD COLUMN IF NOT EXISTS  → no-op when column already exists
--   • DO $$ BEGIN CREATE TYPE … EXCEPTION WHEN duplicate_object THEN NULL END $$
--   • CREATE TABLE IF NOT EXISTS
--   • CREATE INDEX IF NOT EXISTS
--   • DO $$ BEGIN ALTER TABLE … ADD CONSTRAINT … EXCEPTION WHEN duplicate_object THEN NULL END $$
--
-- Deployment on an existing DB that already had the readiness columns applied outside
-- Prisma (20260917140000) but whose migration history row is missing:
--   prisma migrate resolve --applied 20260917140000_add_installment_readiness
--   prisma migrate deploy
-- Fresh DB: prisma migrate deploy (no extra step).

-- 1. Invoice notes (free-text notes stored on the AR document, set at invoice creation)
ALTER TABLE "client_invoices"
  ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- 2. InvoiceDeliveryMethod enum
DO $$ BEGIN
  CREATE TYPE "InvoiceDeliveryMethod" AS ENUM ('WHATSAPP', 'EMAIL', 'PHYSICAL', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. Delivery history table — one row per send event, never overwritten
CREATE TABLE IF NOT EXISTS "client_invoice_deliveries" (
  "id"              TEXT         NOT NULL,
  "organization_id" TEXT         NOT NULL,
  "invoice_id"      TEXT         NOT NULL,
  "method"          "InvoiceDeliveryMethod" NOT NULL,
  "recipient"       TEXT,
  "note"            TEXT,
  "sent_at"         TIMESTAMPTZ  NOT NULL,
  "sent_by"         TEXT         NOT NULL,
  "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "client_invoice_deliveries_pkey" PRIMARY KEY ("id")
);

-- 4. FK: organization
DO $$ BEGIN
  ALTER TABLE "client_invoice_deliveries"
    ADD CONSTRAINT "client_invoice_deliveries_organization_id_fkey"
    FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 5. FK: invoice
DO $$ BEGIN
  ALTER TABLE "client_invoice_deliveries"
    ADD CONSTRAINT "client_invoice_deliveries_invoice_id_fkey"
    FOREIGN KEY ("invoice_id")
    REFERENCES "client_invoices"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 6. Lookup index
CREATE INDEX IF NOT EXISTS "client_invoice_deliveries_organization_id_invoice_id_idx"
  ON "client_invoice_deliveries"("organization_id", "invoice_id");
