-- AlterTable
ALTER TABLE "client_invoices" ADD COLUMN     "source_installment_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "client_invoices_source_installment_id_key" ON "client_invoices"("source_installment_id");

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_source_installment_id_fkey" FOREIGN KEY ("source_installment_id") REFERENCES "contract_payment_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
