-- CreateEnum
CREATE TYPE "ReceivableWriteOffReason" AS ENUM ('BAD_DEBT', 'SMALL_BALANCE');

-- CreateEnum
CREATE TYPE "ReceivableWriteOffStatus" AS ENUM ('PENDING_APPROVAL', 'POSTED', 'REJECTED', 'REVERSED');

-- AlterEnum
ALTER TYPE "AccountSubtype" ADD VALUE 'BAD_DEBT_EXPENSE';

-- AlterEnum
ALTER TYPE "SourceDocType" ADD VALUE 'RECEIVABLE_WRITE_OFF';

-- AlterTable
ALTER TABLE "posting_policy" ADD COLUMN     "write_off_approval_above" DECIMAL(18,2) NOT NULL DEFAULT 50;

-- CreateTable
CREATE TABLE "receivable_write_offs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "write_off_number" VARCHAR(30),
    "reason" "ReceivableWriteOffReason" NOT NULL,
    "note" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "accounting_date" DATE NOT NULL,
    "status" "ReceivableWriteOffStatus" NOT NULL,
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "posted_journal_entry_id" TEXT,
    "posted_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversal_reason" TEXT,
    "reversal_journal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receivable_write_offs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receivable_write_offs_organization_id_status_idx" ON "receivable_write_offs"("organization_id", "status");

-- CreateIndex
CREATE INDEX "receivable_write_offs_organization_id_client_id_idx" ON "receivable_write_offs"("organization_id", "client_id");

-- CreateIndex
CREATE INDEX "receivable_write_offs_invoice_id_idx" ON "receivable_write_offs"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "receivable_write_offs_organization_id_write_off_number_key" ON "receivable_write_offs"("organization_id", "write_off_number");

-- AddForeignKey
ALTER TABLE "receivable_write_offs" ADD CONSTRAINT "receivable_write_offs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "client_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

