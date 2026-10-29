-- CreateEnum
CREATE TYPE "ClientRefundStatus" AS ENUM ('PENDING_APPROVAL', 'POSTED', 'REJECTED', 'REVERSED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'CLIENT_REFUND';

-- AlterEnum
ALTER TYPE "SourceDocType" ADD VALUE 'CLIENT_REFUND';

-- CreateTable
CREATE TABLE "client_refunds" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "refund_number" VARCHAR(30),
    "amount" DECIMAL(18,2) NOT NULL,
    "refund_date" DATE NOT NULL,
    "reference" TEXT,
    "reason" TEXT NOT NULL,
    "status" "ClientRefundStatus" NOT NULL,
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

    CONSTRAINT "client_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_refunds_organization_id_status_idx" ON "client_refunds"("organization_id", "status");

-- CreateIndex
CREATE INDEX "client_refunds_organization_id_client_id_idx" ON "client_refunds"("organization_id", "client_id");

-- CreateIndex
CREATE INDEX "client_refunds_receipt_id_idx" ON "client_refunds"("receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_refunds_organization_id_refund_number_key" ON "client_refunds"("organization_id", "refund_number");

-- AddForeignKey
ALTER TABLE "client_refunds" ADD CONSTRAINT "client_refunds_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "payment_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

