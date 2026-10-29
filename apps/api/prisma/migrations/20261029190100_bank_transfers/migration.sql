-- CreateEnum
CREATE TYPE "BankTransferStatus" AS ENUM ('PENDING_APPROVAL', 'POSTED', 'REJECTED', 'REVERSED');

-- CreateTable
CREATE TABLE "bank_transfers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "transfer_number" VARCHAR(30),
    "from_bank_account_id" TEXT NOT NULL,
    "to_bank_account_id" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL,
    "transfer_date" DATE NOT NULL,
    "reference" VARCHAR(100),
    "memo" TEXT,
    "status" "BankTransferStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "posted_journal_entry_id" TEXT,
    "posted_at" TIMESTAMP(3),
    "reversal_journal_entry_id" TEXT,
    "reversed_by" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversal_reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_transfers_organization_id_status_idx" ON "bank_transfers"("organization_id", "status");

-- CreateIndex
CREATE INDEX "bank_transfers_from_bank_account_id_idx" ON "bank_transfers"("from_bank_account_id");

-- CreateIndex
CREATE INDEX "bank_transfers_to_bank_account_id_idx" ON "bank_transfers"("to_bank_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transfers_organization_id_transfer_number_key" ON "bank_transfers"("organization_id", "transfer_number");

