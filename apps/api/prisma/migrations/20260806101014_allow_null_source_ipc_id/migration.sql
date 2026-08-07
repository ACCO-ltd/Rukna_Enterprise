-- DropForeignKey
ALTER TABLE "client_invoices" DROP CONSTRAINT "client_invoices_source_ipc_id_fkey";

-- AlterTable
ALTER TABLE "client_invoices" ALTER COLUMN "source_ipc_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_source_ipc_id_fkey" FOREIGN KEY ("source_ipc_id") REFERENCES "interim_payment_certificates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
