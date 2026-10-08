-- ADR-045 — paying from the award (procurement quotations Phase 3). Additive only.
-- Legacy buyer advances (posting_status POSTED, posted_journal_entry_id NULL) are left untouched:
-- they are labelled by the read model and never re-posted.

-- CreateEnum
CREATE TYPE "StoreDocumentKind" AS ENUM ('RECEIPT', 'INVOICE');

-- CreateEnum
CREATE TYPE "StoreDocumentStatus" AS ENUM ('SUBMITTED', 'RECORDED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "StoreDocumentRejectReason" AS ENUM ('ILLEGIBLE', 'WRONG_PO', 'DUPLICATE', 'OTHER');

-- AlterEnum
ALTER TYPE "BuyerAdvancePaymentMethod" ADD VALUE 'CASH';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MessagePurpose" ADD VALUE 'QUOTE_PAY_NEEDED';
ALTER TYPE "MessagePurpose" ADD VALUE 'QUOTE_CASH_RELEASED';
ALTER TYPE "MessagePurpose" ADD VALUE 'QUOTE_SUPPLIER_PAID';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'PAYMENT_NEEDED';
ALTER TYPE "NotificationKind" ADD VALUE 'CASH_RELEASED';
ALTER TYPE "NotificationKind" ADD VALUE 'SUPPLIER_PAID';
ALTER TYPE "NotificationKind" ADD VALUE 'RECEIPT_TO_RECORD';
ALTER TYPE "NotificationKind" ADD VALUE 'RECEIPT_REJECTED';

-- AlterEnum
ALTER TYPE "SourceDocType" ADD VALUE 'BUYER_ADVANCE';

-- AlterTable
ALTER TABLE "advance_returns" ADD COLUMN     "journal_entry_id" TEXT;

-- AlterTable
ALTER TABLE "buyer_advance_evidence_allocations" ADD COLUMN     "allocation_date" DATE,
ADD COLUMN     "journal_entry_id" TEXT,
ADD COLUMN     "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
ADD COLUMN     "reversal_journal_entry_id" TEXT,
ADD COLUMN     "reversal_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMP(3),
ADD COLUMN     "reversed_by" TEXT;

-- AlterTable
ALTER TABLE "buyer_advances" ADD COLUMN     "approval_instance_id" TEXT,
ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "idempotency_key" VARCHAR(100),
ADD COLUMN     "quotation_request_id" TEXT,
ADD COLUMN     "reversal_journal_entry_id" TEXT,
ADD COLUMN     "reversal_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMP(3),
ADD COLUMN     "reversed_by" TEXT;

-- AlterTable
ALTER TABLE "supplier_payments" ADD COLUMN     "idempotency_key" VARCHAR(100),
ADD COLUMN     "quotation_request_id" TEXT;

-- CreateTable
CREATE TABLE "store_documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "quotation_request_id" TEXT,
    "kind" "StoreDocumentKind" NOT NULL,
    "status" "StoreDocumentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "client_ref" UUID NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "supplier_bill_id" TEXT,
    "document_date" DATE,
    "entered_total" DECIMAL(18,2),
    "entered_by" TEXT,
    "recorded_at" TIMESTAMP(3),
    "reject_reason" "StoreDocumentRejectReason",
    "reject_note" TEXT,
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_document_photos" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "store_document_id" TEXT NOT NULL,
    "platform_file_id" TEXT NOT NULL,
    "page_number" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "QuotePhotoSource" NOT NULL,
    "uploaded_by" TEXT NOT NULL,

    CONSTRAINT "store_document_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_documents_supplier_bill_id_key" ON "store_documents"("supplier_bill_id");

-- CreateIndex
CREATE INDEX "store_documents_purchase_order_id_status_idx" ON "store_documents"("purchase_order_id", "status");

-- CreateIndex
CREATE INDEX "store_documents_organization_id_status_idx" ON "store_documents"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "store_documents_organization_id_number_key" ON "store_documents"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "store_documents_organization_id_client_ref_key" ON "store_documents"("organization_id", "client_ref");

-- CreateIndex
CREATE UNIQUE INDEX "store_document_photos_platform_file_id_key" ON "store_document_photos"("platform_file_id");

-- CreateIndex
CREATE INDEX "store_document_photos_organization_id_sha256_idx" ON "store_document_photos"("organization_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "store_document_photos_store_document_id_page_number_key" ON "store_document_photos"("store_document_id", "page_number");

-- AddForeignKey
ALTER TABLE "store_documents" ADD CONSTRAINT "store_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_documents" ADD CONSTRAINT "store_documents_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_documents" ADD CONSTRAINT "store_documents_quotation_request_id_fkey" FOREIGN KEY ("quotation_request_id") REFERENCES "quotation_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_documents" ADD CONSTRAINT "store_documents_supplier_bill_id_fkey" FOREIGN KEY ("supplier_bill_id") REFERENCES "supplier_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_document_photos" ADD CONSTRAINT "store_document_photos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_document_photos" ADD CONSTRAINT "store_document_photos_store_document_id_fkey" FOREIGN KEY ("store_document_id") REFERENCES "store_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_document_photos" ADD CONSTRAINT "store_document_photos_platform_file_id_fkey" FOREIGN KEY ("platform_file_id") REFERENCES "platform_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ADR-045 — idempotency of the one-tap money commands: one document per client key per org.
CREATE UNIQUE INDEX "buyer_advances_org_idempotency_key_key"
  ON "buyer_advances"("organization_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX "supplier_payments_org_idempotency_key_key"
  ON "supplier_payments"("organization_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;

-- Lookups of the award's payment documents.
CREATE INDEX "buyer_advances_quotation_request_id_idx" ON "buyer_advances"("quotation_request_id");
CREATE INDEX "supplier_payments_quotation_request_id_idx" ON "supplier_payments"("quotation_request_id");

-- The total finance types from a store receipt is a positive amount.
ALTER TABLE "store_documents" ADD CONSTRAINT "store_documents_entered_total_positive"
  CHECK ("entered_total" IS NULL OR "entered_total" > 0);
