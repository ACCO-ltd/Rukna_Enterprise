-- ADR-044 — competitive quotations between an approved material request and its purchase order.
-- Additive only: three new tables, seven new enums, one value on WorkflowTransactionType and three
-- on NotificationKind. No existing table changes (the PO link lives on quotation_requests). No
-- backfill. PostgreSQL 12+ allows ALTER TYPE ... ADD VALUE inside the migration transaction as long
-- as the new values are not used in the same transaction (they are not).

-- CreateEnum
CREATE TYPE "QuotationRequestStatus" AS ENUM ('COLLECTING', 'AWAITING_DECISION', 'RETURNED', 'AWARD_PENDING_APPROVAL', 'AWARDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'REJECTED');

-- CreateEnum
CREATE TYPE "QuoteRejectReason" AS ENUM ('ILLEGIBLE', 'WRONG_ITEMS', 'INCOMPLETE', 'OTHER');

-- CreateEnum
CREATE TYPE "QuoteCountExceptionReason" AS ENUM ('ONLY_ONE_SUPPLIER', 'URGENT', 'FRAMEWORK_SUPPLIER');

-- CreateEnum
CREATE TYPE "NonLowestReason" AS ENUM ('FASTER_DELIVERY', 'BETTER_QUALITY', 'HAS_STOCK', 'OTHER');

-- CreateEnum
CREATE TYPE "QuotationPaymentPath" AS ENUM ('BUYER_CASH', 'FINANCE_PAYS_SUPPLIER');

-- CreateEnum
CREATE TYPE "QuotePhotoSource" AS ENUM ('CAMERA', 'GALLERY', 'UNKNOWN');

-- AlterEnum


ALTER TYPE "NotificationKind" ADD VALUE 'QUOTES_READY';
ALTER TYPE "NotificationKind" ADD VALUE 'QUOTATION_AWARDED';
ALTER TYPE "NotificationKind" ADD VALUE 'ANOTHER_QUOTE_REQUESTED';

-- AlterEnum
ALTER TYPE "WorkflowTransactionType" ADD VALUE 'QUOTATION_AWARD';

-- CreateTable
CREATE TABLE "quotation_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "material_request_id" TEXT NOT NULL,
    "project_id" TEXT,
    "currency_code" VARCHAR(3) NOT NULL,
    "status" "QuotationRequestStatus" NOT NULL DEFAULT 'COLLECTING',
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "estimate_amount" DECIMAL(18,2),
    "required_quote_count" INTEGER NOT NULL DEFAULT 1,
    "exception_reason" "QuoteCountExceptionReason",
    "exception_accepted_by" TEXT,
    "exception_accepted_at" TIMESTAMP(3),
    "return_note" TEXT,
    "returned_by" TEXT,
    "returned_at" TIMESTAMP(3),
    "send_count" INTEGER NOT NULL DEFAULT 0,
    "first_sent_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "proposed_quote_id" TEXT,
    "proposed_by" TEXT,
    "proposed_at" TIMESTAMP(3),
    "proposed_payment_path" "QuotationPaymentPath",
    "proposed_non_lowest_reason" "NonLowestReason",
    "proposed_non_lowest_note" TEXT,
    "proposed_supplier_id" TEXT,
    "proposed_accept_exception" BOOLEAN NOT NULL DEFAULT false,
    "awarded_quote_id" TEXT,
    "awarded_total" DECIMAL(18,2),
    "awarded_supplier_id" TEXT,
    "awarded_by" TEXT,
    "awarded_at" TIMESTAMP(3),
    "award_approval_instance_id" TEXT,
    "award_final_approver_id" TEXT,
    "non_lowest_reason" "NonLowestReason",
    "non_lowest_note" TEXT,
    "payment_path" "QuotationPaymentPath",
    "purchase_order_id" TEXT,
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_quotes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quotation_request_id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "store_name" VARCHAR(120),
    "store_key" VARCHAR(200) NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'ACTIVE',
    "reject_reason" "QuoteRejectReason",
    "reject_note" TEXT,
    "entered_total" DECIMAL(18,2),
    "entered_by" TEXT,
    "entered_at" TIMESTAMP(3),
    "uploaded_by" TEXT NOT NULL,
    "client_ref" UUID NOT NULL,
    "replaces_quote_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_quote_photos" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "platform_file_id" TEXT NOT NULL,
    "page_number" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "QuotePhotoSource" NOT NULL,
    "uploaded_by" TEXT NOT NULL,

    CONSTRAINT "quotation_quote_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotation_requests_purchase_order_id_key" ON "quotation_requests"("purchase_order_id");

-- CreateIndex
CREATE INDEX "quotation_requests_organization_id_status_sent_at_idx" ON "quotation_requests"("organization_id", "status", "sent_at");

-- CreateIndex
CREATE INDEX "quotation_requests_material_request_id_idx" ON "quotation_requests"("material_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_requests_organization_id_number_key" ON "quotation_requests"("organization_id", "number");

-- CreateIndex
CREATE INDEX "quotation_quotes_organization_id_idx" ON "quotation_quotes"("organization_id");

-- CreateIndex
CREATE INDEX "quotation_quotes_quotation_request_id_status_idx" ON "quotation_quotes"("quotation_request_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_quotes_quotation_request_id_client_ref_key" ON "quotation_quotes"("quotation_request_id", "client_ref");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_quote_photos_platform_file_id_key" ON "quotation_quote_photos"("platform_file_id");

-- CreateIndex
CREATE INDEX "quotation_quote_photos_organization_id_sha256_idx" ON "quotation_quote_photos"("organization_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_quote_photos_quote_id_page_number_key" ON "quotation_quote_photos"("quote_id", "page_number");

-- AddForeignKey
ALTER TABLE "quotation_requests" ADD CONSTRAINT "quotation_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_requests" ADD CONSTRAINT "quotation_requests_material_request_id_fkey" FOREIGN KEY ("material_request_id") REFERENCES "material_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_requests" ADD CONSTRAINT "quotation_requests_awarded_supplier_id_fkey" FOREIGN KEY ("awarded_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_requests" ADD CONSTRAINT "quotation_requests_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_quotes" ADD CONSTRAINT "quotation_quotes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_quotes" ADD CONSTRAINT "quotation_quotes_quotation_request_id_fkey" FOREIGN KEY ("quotation_request_id") REFERENCES "quotation_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_quotes" ADD CONSTRAINT "quotation_quotes_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_quote_photos" ADD CONSTRAINT "quotation_quote_photos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_quote_photos" ADD CONSTRAINT "quotation_quote_photos_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotation_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_quote_photos" ADD CONSTRAINT "quotation_quote_photos_platform_file_id_fkey" FOREIGN KEY ("platform_file_id") REFERENCES "platform_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ADR-044 §1 / invariant 7 — at most one LIVE (non-cancelled) quotation request per material
-- request. A cancelled request does not block a fresh one.
CREATE UNIQUE INDEX "quotation_requests_one_live_per_mr"
  ON "quotation_requests" ("organization_id", "material_request_id")
  WHERE "status" <> 'CANCELLED';

-- ADR-044 §2 — a quote names either a registered supplier or a new store, never both, never neither.
ALTER TABLE "quotation_quotes"
  ADD CONSTRAINT "quotation_quotes_supplier_xor_store_name"
  CHECK (("supplier_id" IS NULL) <> ("store_name" IS NULL));
