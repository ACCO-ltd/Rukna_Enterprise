-- AlterTable
ALTER TABLE "supplier_payments" ADD COLUMN     "instrument_date" DATE,
ADD COLUMN     "payee_account" VARCHAR(50),
ADD COLUMN     "payee_name" VARCHAR(150),
ADD COLUMN     "provider" VARCHAR(20),
ADD COLUMN     "reversal_journal_entry_id" TEXT,
ADD COLUMN     "reversal_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMP(3),
ADD COLUMN     "reversed_by" TEXT;

-- SP-3: one live payment per reference from the same account and method — a cheque number or a
-- transfer reference is used once. Matched trimmed and case-blind; a reversed, cancelled or
-- rejected payment frees its number.
CREATE UNIQUE INDEX "supplier_payments_live_reference_key"
  ON "supplier_payments" ("organization_id", "bank_account_id", "payment_method", UPPER(TRIM("bank_reference")))
  WHERE "bank_reference" IS NOT NULL
    AND TRIM("bank_reference") <> ''
    AND "posting_status" <> 'REVERSED'
    AND "document_status" NOT IN ('CANCELLED', 'REJECTED');
