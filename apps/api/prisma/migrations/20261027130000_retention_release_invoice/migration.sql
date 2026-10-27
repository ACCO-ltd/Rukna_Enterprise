-- ADR-046 §5 — the retention release invoice: one per contract, billing the retention its IPC
-- invoices held back (Dr AR / Cr Retention Receivable). Additive only.
-- AlterTable
ALTER TABLE "client_invoices" ADD COLUMN     "retention_released_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "source_retention_contract_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "client_invoices_source_retention_contract_id_key" ON "client_invoices"("source_retention_contract_id");

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_source_retention_contract_id_fkey" FOREIGN KEY ("source_retention_contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

