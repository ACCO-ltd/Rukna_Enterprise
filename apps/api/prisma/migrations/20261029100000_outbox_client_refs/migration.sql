-- AlterTable
ALTER TABLE "goods_receipt_notes" ADD COLUMN     "client_ref" VARCHAR(64);

-- AlterTable
ALTER TABLE "material_requests" ADD COLUMN     "client_ref" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_notes_organization_id_client_ref_key" ON "goods_receipt_notes"("organization_id", "client_ref");

-- CreateIndex
CREATE UNIQUE INDEX "material_requests_organization_id_client_ref_key" ON "material_requests"("organization_id", "client_ref");

