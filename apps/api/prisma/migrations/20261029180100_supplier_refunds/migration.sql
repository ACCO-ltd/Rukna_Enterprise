-- CreateEnum
CREATE TYPE "SupplierRefundStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "supplier_refunds" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "supplier_payment_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "refund_number" VARCHAR(30),
    "refund_date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL,
    "reference" VARCHAR(100),
    "reason" TEXT NOT NULL,
    "status" "SupplierRefundStatus" NOT NULL DEFAULT 'POSTED',
    "posted_journal_entry_id" TEXT,
    "reversal_journal_entry_id" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "reversal_reason" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_refunds_organization_id_supplier_id_idx" ON "supplier_refunds"("organization_id", "supplier_id");

-- CreateIndex
CREATE INDEX "supplier_refunds_supplier_payment_id_idx" ON "supplier_refunds"("supplier_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_refunds_organization_id_refund_number_key" ON "supplier_refunds"("organization_id", "refund_number");

-- AddForeignKey
ALTER TABLE "supplier_refunds" ADD CONSTRAINT "supplier_refunds_supplier_payment_id_fkey" FOREIGN KEY ("supplier_payment_id") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

