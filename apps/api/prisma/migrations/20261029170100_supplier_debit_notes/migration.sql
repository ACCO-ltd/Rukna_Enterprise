-- CreateEnum
CREATE TYPE "SupplierDebitNoteStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "supplier_debit_notes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "supplier_bill_id" TEXT NOT NULL,
    "debit_note_number" VARCHAR(30),
    "supplier_reference" VARCHAR(100),
    "reason" TEXT NOT NULL,
    "accounting_date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL,
    "status" "SupplierDebitNoteStatus" NOT NULL DEFAULT 'POSTED',
    "posted_journal_entry_id" TEXT,
    "reversal_journal_entry_id" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "reversal_reason" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_debit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_debit_notes_organization_id_supplier_id_idx" ON "supplier_debit_notes"("organization_id", "supplier_id");

-- CreateIndex
CREATE INDEX "supplier_debit_notes_supplier_bill_id_idx" ON "supplier_debit_notes"("supplier_bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_debit_notes_organization_id_debit_note_number_key" ON "supplier_debit_notes"("organization_id", "debit_note_number");

-- AddForeignKey
ALTER TABLE "supplier_debit_notes" ADD CONSTRAINT "supplier_debit_notes_supplier_bill_id_fkey" FOREIGN KEY ("supplier_bill_id") REFERENCES "supplier_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

