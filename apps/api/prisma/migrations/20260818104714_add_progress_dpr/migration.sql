-- CreateEnum
CREATE TYPE "DprStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED');

-- CreateTable
CREATE TABLE "daily_progress_reports" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "report_date" DATE NOT NULL,
    "status" "DprStatus" NOT NULL DEFAULT 'DRAFT',
    "weather" TEXT,
    "labour_count" INTEGER,
    "equipment_note" TEXT,
    "narrative" TEXT,
    "delay_reason" TEXT,
    "prepared_by" TEXT NOT NULL,
    "submitted_by" TEXT,
    "submitted_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "return_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_progress_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_measurements" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "dpr_id" TEXT NOT NULL,
    "boq_node_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "notes" TEXT,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "progress_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dpr_attachments" (
    "id" TEXT NOT NULL,
    "dpr_id" TEXT NOT NULL,
    "platform_file_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "dpr_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_progress_reports_project_id_report_date_idx" ON "daily_progress_reports"("project_id", "report_date");

-- CreateIndex
CREATE INDEX "progress_measurements_dpr_id_idx" ON "progress_measurements"("dpr_id");

-- CreateIndex
CREATE INDEX "progress_measurements_boq_node_id_idx" ON "progress_measurements"("boq_node_id");

-- CreateIndex
CREATE INDEX "dpr_attachments_dpr_id_idx" ON "dpr_attachments"("dpr_id");

-- AddForeignKey
ALTER TABLE "daily_progress_reports" ADD CONSTRAINT "daily_progress_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_measurements" ADD CONSTRAINT "progress_measurements_dpr_id_fkey" FOREIGN KEY ("dpr_id") REFERENCES "daily_progress_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_measurements" ADD CONSTRAINT "progress_measurements_boq_node_id_fkey" FOREIGN KEY ("boq_node_id") REFERENCES "boq_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dpr_attachments" ADD CONSTRAINT "dpr_attachments_dpr_id_fkey" FOREIGN KEY ("dpr_id") REFERENCES "daily_progress_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dpr_attachments" ADD CONSTRAINT "dpr_attachments_platform_file_id_fkey" FOREIGN KEY ("platform_file_id") REFERENCES "platform_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

