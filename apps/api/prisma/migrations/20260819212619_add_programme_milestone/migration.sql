-- ADR-021 phase 2: programme delivery milestones (baseline/forecast/actual dates, PLANNED→VERIFIED),
-- and the optional link from a MILESTONE payment installment to a verified milestone (CONST-COM-011).

-- CreateEnum
CREATE TYPE "ProgrammeMilestoneStatus" AS ENUM ('PLANNED', 'VERIFIED');

-- AlterTable
ALTER TABLE "contract_payment_installments" ADD COLUMN     "programme_milestone_id" TEXT;

-- CreateTable
CREATE TABLE "programme_milestones" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ProgrammeMilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "baseline_date" DATE NOT NULL,
    "forecast_date" DATE,
    "actual_date" DATE,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "contract_milestone_id" TEXT,
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programme_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "programme_milestones_project_id_idx" ON "programme_milestones"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "programme_milestones_project_id_code_key" ON "programme_milestones"("project_id", "code");

-- AddForeignKey
ALTER TABLE "programme_milestones" ADD CONSTRAINT "programme_milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_milestones" ADD CONSTRAINT "programme_milestones_contract_milestone_id_fkey" FOREIGN KEY ("contract_milestone_id") REFERENCES "contract_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_payment_installments" ADD CONSTRAINT "contract_payment_installments_programme_milestone_id_fkey" FOREIGN KEY ("programme_milestone_id") REFERENCES "programme_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
