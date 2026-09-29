-- Commercial tab follow-up (2026-09-28): client payments get a document number, like invoices.
--
-- A receipt is numbered from the organisation's PAYMENT_RECEIPT sequence (prefix RCP-) in the same
-- transaction that posts it. Receipts already posted (or posted then reversed) are numbered here in
-- the order they were posted, and the sequence is advanced past them, so new numbers follow on.
-- Draft and opening-balance receipts stay unnumbered.

-- AlterTable
ALTER TABLE "payment_receipts" ADD COLUMN "receipt_number" VARCHAR(50);

-- An organisation with posted receipts but no receipt sequence (never seeded) gets one.
INSERT INTO "document_number_sequences"
  ("id", "organization_id", "document_type", "journal_category", "prefix", "next_number", "padding_length", "version", "status", "created_at")
SELECT 'seq_rcp_' || md5(r."organization_id"), r."organization_id", 'PAYMENT_RECEIPT', NULL, 'RCP-', 1, 6, 1, 'ACTIVE', CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT "organization_id" FROM "payment_receipts" WHERE "posting_status" IN ('POSTED', 'REVERSED')
) AS r
WHERE NOT EXISTS (
  SELECT 1 FROM "document_number_sequences" AS s
  WHERE s."organization_id" = r."organization_id"
    AND s."document_type" = 'PAYMENT_RECEIPT'
    AND s."journal_category" IS NULL
);

-- Backfill in posting order, continuing from the sequence's next number.
WITH numbered AS (
  SELECT
    r."id",
    s."prefix",
    s."padding_length",
    s."next_number" - 1 + ROW_NUMBER() OVER (
      PARTITION BY r."organization_id"
      ORDER BY r."posted_at" NULLS LAST, r."created_at", r."id"
    ) AS n
  FROM "payment_receipts" AS r
  JOIN "document_number_sequences" AS s
    ON s."organization_id" = r."organization_id"
   AND s."document_type" = 'PAYMENT_RECEIPT'
   AND s."journal_category" IS NULL
  WHERE r."posting_status" IN ('POSTED', 'REVERSED')
)
UPDATE "payment_receipts" AS p
SET "receipt_number" = numbered."prefix" || LPAD(numbered.n::text, numbered."padding_length", '0')
FROM numbered
WHERE p."id" = numbered."id";

UPDATE "document_number_sequences" AS s
SET "next_number" = s."next_number" + c.cnt,
    "version" = s."version" + 1
FROM (
  SELECT "organization_id", COUNT(*) AS cnt
  FROM "payment_receipts"
  WHERE "receipt_number" IS NOT NULL
  GROUP BY "organization_id"
) AS c
WHERE s."organization_id" = c."organization_id"
  AND s."document_type" = 'PAYMENT_RECEIPT'
  AND s."journal_category" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_organization_id_receipt_number_key" ON "payment_receipts"("organization_id", "receipt_number");
