-- AlterTable
ALTER TABLE "work_packages" ADD COLUMN     "duration_days" INTEGER,
ADD COLUMN     "forecast_end" DATE,
ADD COLUMN     "planned_end" DATE,
ADD COLUMN     "planned_start" DATE,
ADD COLUMN     "schedule_only" BOOLEAN NOT NULL DEFAULT false;
