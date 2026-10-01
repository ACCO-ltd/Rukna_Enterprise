-- ADR-041 — client invoice tax from configured tax codes.
--
-- 1. Tax codes say which side they apply to (OUTPUT = client invoices, INPUT = purchases).
-- 2. Client invoices record the tax code and rate (percent) they were raised at.
-- 3. Every organisation keeps today's behaviour (5% sales tax) — now as data Finance can change.

-- ── 1. Tax code direction ────────────────────────────────────────────────────
CREATE TYPE "TaxDirection" AS ENUM ('OUTPUT', 'INPUT');

ALTER TABLE "tax_codes" ADD COLUMN "direction" "TaxDirection";

-- Input codes are the non-recoverable / partially recoverable ones, those with an input-tax
-- account, and those named as input (`VAT5_IN`, the short `…_I`). Everything else taxes sales.
UPDATE "tax_codes"
SET "direction" = CASE
  WHEN "recovery_method" IN ('NON_RECOVERABLE', 'PARTIALLY_RECOVERABLE')
    OR "input_tax_account_id" IS NOT NULL
    OR "code" LIKE '%\_IN'
    OR "code" LIKE '%\_I'
  THEN 'INPUT'::"TaxDirection"
  ELSE 'OUTPUT'::"TaxDirection"
END;

ALTER TABLE "tax_codes" ALTER COLUMN "direction" SET NOT NULL;

-- ── 2. Invoice tax snapshot ──────────────────────────────────────────────────
ALTER TABLE "client_invoices"
  ADD COLUMN "tax_code_id" TEXT,
  ADD COLUMN "tax_rate" DECIMAL(7,4) NOT NULL DEFAULT 0;

CREATE INDEX "client_invoices_tax_code_id_idx" ON "client_invoices"("tax_code_id");

ALTER TABLE "client_invoices"
  ADD CONSTRAINT "client_invoices_tax_code_id_fkey"
  FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every invoice generated so far was raised at the fixed 5%. Tax is rounded to cents, so a 5% invoice
-- is recognised by its tax being within a cent of 5% of the subtotal; anything else (a migration-
-- loaded invoice at another rate) keeps the rate its own figures imply. No tax → 0.
UPDATE "client_invoices"
SET "tax_rate" = CASE
  WHEN "vat_amount" = 0 OR "subtotal" = 0 THEN 0
  WHEN ABS("vat_amount" - ROUND("subtotal" * 0.05, 2)) <= 0.01 THEN 5
  ELSE ROUND("vat_amount" / "subtotal" * 100, 4)
END;

-- ── 3. Default sales tax per organisation ────────────────────────────────────
-- An organisation with no sales tax code gets `VAT5_OUT` "Sales tax 5%", in force from 2000-01-01 so
-- it covers any invoice date. Output tax is never "recovered"; FULLY_RECOVERABLE mirrors the seed.
INSERT INTO "tax_codes" (
  "id", "organization_id", "code", "name", "rate", "tax_type", "direction", "recovery_method",
  "effective_from", "status", "created_at", "created_by"
)
SELECT
  'txc_' || md5(o."id" || ':VAT5_OUT'), o."id", 'VAT5_OUT', 'Sales tax 5%', 5, 'VAT', 'OUTPUT',
  'FULLY_RECOVERABLE', DATE '2000-01-01', 'ACTIVE', now(), 'system:adr-041'
FROM "organizations" o
WHERE NOT EXISTS (
    SELECT 1 FROM "tax_codes" t WHERE t."organization_id" = o."id" AND t."direction" = 'OUTPUT'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "tax_codes" t WHERE t."organization_id" = o."id" AND t."code" = 'VAT5_OUT'
  );

-- The default: an existing default is kept; otherwise the organisation's 5% sales code if it has
-- one, else its oldest active sales code.
INSERT INTO "tax_policy" ("organization_id", "default_output_tax_code_id", "updated_by", "updated_at")
SELECT
  o."id",
  (
    SELECT t."id" FROM "tax_codes" t
    WHERE t."organization_id" = o."id" AND t."direction" = 'OUTPUT' AND t."status" = 'ACTIVE'
    ORDER BY (t."rate" = 5) DESC, t."created_at" ASC
    LIMIT 1
  ),
  'system:adr-041',
  now()
FROM "organizations" o
ON CONFLICT ("organization_id") DO UPDATE
SET "default_output_tax_code_id" = EXCLUDED."default_output_tax_code_id",
    "updated_by" = EXCLUDED."updated_by",
    "updated_at" = EXCLUDED."updated_at"
WHERE "tax_policy"."default_output_tax_code_id" IS NULL;
