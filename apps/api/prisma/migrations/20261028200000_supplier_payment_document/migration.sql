-- AlterTable
ALTER TABLE "supplier_payments" ADD COLUMN     "document_file_id" TEXT;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_document_file_id_fkey" FOREIGN KEY ("document_file_id") REFERENCES "platform_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

