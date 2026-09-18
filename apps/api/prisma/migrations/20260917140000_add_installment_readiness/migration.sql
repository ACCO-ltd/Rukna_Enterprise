-- Slice 3B: commercial readiness gate on ContractPaymentInstallment.
-- readyToBill is derived as (ready_to_bill_at IS NOT NULL) — no stored boolean.
-- All columns nullable → zero-downtime, no data migration required.
ALTER TABLE "contract_payment_installments"
  ADD COLUMN IF NOT EXISTS "ready_to_bill_at"  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "ready_to_bill_by"  TEXT,
  ADD COLUMN IF NOT EXISTS "readiness_note"    TEXT;
