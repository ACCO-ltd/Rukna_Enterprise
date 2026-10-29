-- ADR-046 §5 — retention release invoices: each bills the retention a contract's IPC invoices held
-- back, less what earlier release invoices already billed (Dr AR / Cr Retention Receivable). Not
-- unique per contract: a reversed release is raised again, later retention by a top-up. Additive.
-- AlterTable
ALTER TABLE "client_invoices" ADD COLUMN     "retention_released_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "source_retention_contract_id" TEXT;

-- CreateIndex
CREATE INDEX "client_invoices_source_retention_contract_id_idx" ON "client_invoices"("source_retention_contract_id");

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_source_retention_contract_id_fkey" FOREIGN KEY ("source_retention_contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

