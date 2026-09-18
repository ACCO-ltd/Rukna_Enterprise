-- Slice 8: add optional idempotency key to payment receipts so that clients can safely
-- retry a recordProjectPayment call without creating a duplicate receipt.
-- The column is nullable so existing rows are unaffected; the partial unique index fires
-- only when the value is not null.

ALTER TABLE "payment_receipts" ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "payment_receipts_idempotency_key_key"
  ON "payment_receipts"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
