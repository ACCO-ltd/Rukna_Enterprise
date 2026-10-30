-- CreateEnum
CREATE TYPE "BankAccountKind" AS ENUM ('BANK', 'CASH', 'MOBILE_WALLET');

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "kind" "BankAccountKind" NOT NULL DEFAULT 'BANK';

-- AlterTable
ALTER TABLE "payment_receipts" ADD COLUMN     "instrument_date" DATE,
ADD COLUMN     "instrument_number" VARCHAR(60),
ADD COLUMN     "issuer" VARCHAR(80),
ADD COLUMN     "payer_account" VARCHAR(30),
ADD COLUMN     "payer_name" VARCHAR(150),
ADD COLUMN     "received_by" VARCHAR(100);

-- PM-2: one live receipt per payment proof. The service stores numbers trimmed and upper-cased;
-- a reversed (bounced cheque) or cancelled receipt frees its number to be recorded again.
CREATE UNIQUE INDEX "payment_receipts_live_instrument_key"
  ON "payment_receipts" ("organization_id", "payment_method", COALESCE("issuer", ''), "instrument_number")
  WHERE "instrument_number" IS NOT NULL
    AND "posting_status" <> 'REVERSED'
    AND "document_status" <> 'CANCELLED';
