-- Slice 6B: Collection Events + Credit Notes
-- CreateEnum
CREATE TYPE "FollowUpMethod" AS ENUM ('WHATSAPP', 'EMAIL', 'PHONE', 'PHYSICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeReason" AS ENUM ('OMISSION', 'PRICE_ERROR', 'WORK_NOT_ACCEPTED', 'SCOPE_DISAGREEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "CreditNoteReason" AS ENUM ('OMISSION', 'PRICE_ERROR', 'CORRECTION', 'NEGATIVE_VARIATION');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'CREDIT_NOTE';

-- AlterEnum
ALTER TYPE "SourceDocType" ADD VALUE 'CREDIT_NOTE';

-- CreateTable
CREATE TABLE "invoice_follow_ups" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "method" "FollowUpMethod" NOT NULL,
    "contact_person" TEXT,
    "note" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_payment_promises" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "promised_date" DATE NOT NULL,
    "promised_amount" DECIMAL(18,2),
    "outstanding_at_promise" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_payment_promises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_disputes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "disputed_amount" DECIMAL(18,2),
    "reason" "DisputeReason" NOT NULL,
    "note" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_by" TEXT NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "credit_note_number" VARCHAR(30),
    "source_variation_id" TEXT,
    "reason" "CreditNoteReason" NOT NULL,
    "net_amount" DECIMAL(18,2) NOT NULL,
    "vat_amount" DECIMAL(18,2) NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "accounting_date" DATE NOT NULL,
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "posted_journal_entry_id" TEXT,
    "note" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_follow_ups_organization_id_invoice_id_idx" ON "invoice_follow_ups"("organization_id", "invoice_id");

-- CreateIndex
CREATE INDEX "invoice_payment_promises_organization_id_invoice_id_idx" ON "invoice_payment_promises"("organization_id", "invoice_id");

-- CreateIndex
CREATE INDEX "invoice_disputes_organization_id_invoice_id_idx" ON "invoice_disputes"("organization_id", "invoice_id");

-- CreateIndex
CREATE INDEX "credit_notes_organization_id_invoice_id_idx" ON "credit_notes"("organization_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_organization_id_credit_note_number_key" ON "credit_notes"("organization_id", "credit_note_number");

-- AddForeignKey
ALTER TABLE "invoice_follow_ups" ADD CONSTRAINT "invoice_follow_ups_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "client_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payment_promises" ADD CONSTRAINT "invoice_payment_promises_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "client_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_disputes" ADD CONSTRAINT "invoice_disputes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "client_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "client_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
