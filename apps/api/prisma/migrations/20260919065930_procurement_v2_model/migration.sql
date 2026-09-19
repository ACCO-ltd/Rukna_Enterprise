-- CreateEnum
CREATE TYPE "BuyerAdvancePaymentMethod" AS ENUM ('BANK', 'MOBILE_MONEY');

-- CreateEnum
CREATE TYPE "AdvanceReturnMethod" AS ENUM ('CASH', 'BANK', 'MOBILE_MONEY');

-- CreateEnum
CREATE TYPE "PoRevisionAttachmentPurpose" AS ENUM ('QUOTATION', 'OTHER');

-- CreateEnum
CREATE TYPE "GrnAttachmentPurpose" AS ENUM ('DELIVERY_NOTE', 'OTHER');

-- AlterEnum
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'DRAFT';

-- DropForeignKey
ALTER TABLE "client_invoice_deliveries" DROP CONSTRAINT "client_invoice_deliveries_organization_id_fkey";

-- AlterTable
ALTER TABLE "client_invoice_deliveries" ALTER COLUMN "sent_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "contract_payment_installments" ALTER COLUMN "ready_to_bill_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "goods_receipt_notes" ADD COLUMN     "over_receipt_flag" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "purchase_order_revisions" ADD COLUMN     "quotation_date" DATE,
ADD COLUMN     "quotation_ref" TEXT,
ADD COLUMN     "quoted_amount" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "supplier_payment_purchase_allocations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "supplier_payment_id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "allocated_amount" DECIMAL(18,2) NOT NULL,
    "allocation_date" DATE NOT NULL,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payment_purchase_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_advances" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "recipient_user_id" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL,
    "payment_method" "BuyerAdvancePaymentMethod" NOT NULL,
    "disbursement_bank_account_id" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "advanced_at" DATE NOT NULL,
    "document_status" "PaymentDocStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "posted_journal_entry_id" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_returns" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "buyer_advance_id" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "return_method" "AdvanceReturnMethod" NOT NULL,
    "destination_bank_account_id" TEXT,
    "received_by" TEXT NOT NULL,
    "received_at" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advance_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_advance_evidence_allocations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "buyer_advance_id" TEXT NOT NULL,
    "supplier_bill_id" TEXT NOT NULL,
    "allocated_amount" DECIMAL(18,2) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_advance_evidence_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_revision_attachments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "purchase_order_revision_id" TEXT NOT NULL,
    "platform_file_id" TEXT NOT NULL,
    "purpose" "PoRevisionAttachmentPurpose" NOT NULL DEFAULT 'QUOTATION',
    "supplier_ref" TEXT,
    "attached_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_revision_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_attachments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "goods_receipt_note_id" TEXT NOT NULL,
    "platform_file_id" TEXT NOT NULL,
    "purpose" "GrnAttachmentPurpose" NOT NULL DEFAULT 'DELIVERY_NOTE',
    "attached_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipt_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_payment_purchase_allocations_supplier_payment_id_idx" ON "supplier_payment_purchase_allocations"("supplier_payment_id");

-- CreateIndex
CREATE INDEX "supplier_payment_purchase_allocations_purchase_order_id_idx" ON "supplier_payment_purchase_allocations"("purchase_order_id");

-- CreateIndex
CREATE INDEX "buyer_advances_organization_id_purchase_order_id_idx" ON "buyer_advances"("organization_id", "purchase_order_id");

-- CreateIndex
CREATE INDEX "buyer_advances_recipient_user_id_idx" ON "buyer_advances"("recipient_user_id");

-- CreateIndex
CREATE INDEX "advance_returns_buyer_advance_id_idx" ON "advance_returns"("buyer_advance_id");

-- CreateIndex
CREATE INDEX "buyer_advance_evidence_allocations_buyer_advance_id_idx" ON "buyer_advance_evidence_allocations"("buyer_advance_id");

-- CreateIndex
CREATE INDEX "buyer_advance_evidence_allocations_supplier_bill_id_idx" ON "buyer_advance_evidence_allocations"("supplier_bill_id");

-- CreateIndex
CREATE INDEX "purchase_order_revision_attachments_purchase_order_revision_idx" ON "purchase_order_revision_attachments"("purchase_order_revision_id");

-- CreateIndex
CREATE INDEX "goods_receipt_attachments_goods_receipt_note_id_idx" ON "goods_receipt_attachments"("goods_receipt_note_id");

-- AddForeignKey
ALTER TABLE "supplier_payment_purchase_allocations" ADD CONSTRAINT "supplier_payment_purchase_allocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_purchase_allocations" ADD CONSTRAINT "supplier_payment_purchase_allocations_supplier_payment_id_fkey" FOREIGN KEY ("supplier_payment_id") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_purchase_allocations" ADD CONSTRAINT "supplier_payment_purchase_allocations_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_advances" ADD CONSTRAINT "buyer_advances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_advances" ADD CONSTRAINT "buyer_advances_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_advances" ADD CONSTRAINT "buyer_advances_disbursement_bank_account_id_fkey" FOREIGN KEY ("disbursement_bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_returns" ADD CONSTRAINT "advance_returns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_returns" ADD CONSTRAINT "advance_returns_buyer_advance_id_fkey" FOREIGN KEY ("buyer_advance_id") REFERENCES "buyer_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_returns" ADD CONSTRAINT "advance_returns_destination_bank_account_id_fkey" FOREIGN KEY ("destination_bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_advance_evidence_allocations" ADD CONSTRAINT "buyer_advance_evidence_allocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_advance_evidence_allocations" ADD CONSTRAINT "buyer_advance_evidence_allocations_buyer_advance_id_fkey" FOREIGN KEY ("buyer_advance_id") REFERENCES "buyer_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_advance_evidence_allocations" ADD CONSTRAINT "buyer_advance_evidence_allocations_supplier_bill_id_fkey" FOREIGN KEY ("supplier_bill_id") REFERENCES "supplier_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_revision_attachments" ADD CONSTRAINT "purchase_order_revision_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_revision_attachments" ADD CONSTRAINT "purchase_order_revision_attachments_purchase_order_revisio_fkey" FOREIGN KEY ("purchase_order_revision_id") REFERENCES "purchase_order_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_revision_attachments" ADD CONSTRAINT "purchase_order_revision_attachments_platform_file_id_fkey" FOREIGN KEY ("platform_file_id") REFERENCES "platform_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_attachments" ADD CONSTRAINT "goods_receipt_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_attachments" ADD CONSTRAINT "goods_receipt_attachments_goods_receipt_note_id_fkey" FOREIGN KEY ("goods_receipt_note_id") REFERENCES "goods_receipt_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_attachments" ADD CONSTRAINT "goods_receipt_attachments_platform_file_id_fkey" FOREIGN KEY ("platform_file_id") REFERENCES "platform_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
