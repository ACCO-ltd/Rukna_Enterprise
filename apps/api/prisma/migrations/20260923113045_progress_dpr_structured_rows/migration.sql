-- CreateEnum
CREATE TYPE "DprObservationCategory" AS ENUM ('ISSUE', 'DELAY', 'SAFETY');

-- AlterTable
ALTER TABLE "daily_progress_reports" ADD COLUMN     "location_area" TEXT,
ADD COLUMN     "shift" TEXT,
ADD COLUMN     "tomorrow_plan" TEXT;

-- CreateTable
CREATE TABLE "dpr_labour_rows" (
    "id" TEXT NOT NULL,
    "dpr_id" TEXT NOT NULL,
    "trade" TEXT NOT NULL,
    "headcount" INTEGER NOT NULL,
    "contractor" TEXT,
    "hours" DECIMAL(6,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dpr_labour_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dpr_equipment_rows" (
    "id" TEXT NOT NULL,
    "dpr_id" TEXT NOT NULL,
    "equipment_type" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "hours_worked" DECIMAL(6,2),
    "condition" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dpr_equipment_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dpr_observations" (
    "id" TEXT NOT NULL,
    "dpr_id" TEXT NOT NULL,
    "category" "DprObservationCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "affected_work" TEXT,
    "severity" TEXT,
    "follow_up_owner" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dpr_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dpr_labour_rows_dpr_id_idx" ON "dpr_labour_rows"("dpr_id");

-- CreateIndex
CREATE INDEX "dpr_equipment_rows_dpr_id_idx" ON "dpr_equipment_rows"("dpr_id");

-- CreateIndex
CREATE INDEX "dpr_observations_dpr_id_idx" ON "dpr_observations"("dpr_id");

-- AddForeignKey
ALTER TABLE "dpr_labour_rows" ADD CONSTRAINT "dpr_labour_rows_dpr_id_fkey" FOREIGN KEY ("dpr_id") REFERENCES "daily_progress_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dpr_equipment_rows" ADD CONSTRAINT "dpr_equipment_rows_dpr_id_fkey" FOREIGN KEY ("dpr_id") REFERENCES "daily_progress_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dpr_observations" ADD CONSTRAINT "dpr_observations_dpr_id_fkey" FOREIGN KEY ("dpr_id") REFERENCES "daily_progress_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
