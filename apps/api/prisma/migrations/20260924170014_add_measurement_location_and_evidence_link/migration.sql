-- AlterTable
ALTER TABLE "dpr_attachments" ADD COLUMN     "measurement_id" TEXT;

-- AlterTable
ALTER TABLE "progress_measurements" ADD COLUMN     "location_area" TEXT;

-- CreateIndex
CREATE INDEX "dpr_attachments_measurement_id_idx" ON "dpr_attachments"("measurement_id");

-- AddForeignKey
ALTER TABLE "dpr_attachments" ADD CONSTRAINT "dpr_attachments_measurement_id_fkey" FOREIGN KEY ("measurement_id") REFERENCES "progress_measurements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
