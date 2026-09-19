ALTER TABLE "contracts"
  ADD COLUMN IF NOT EXISTS "signed_date" DATE,
  ADD COLUMN IF NOT EXISTS "payment_terms" TEXT;
