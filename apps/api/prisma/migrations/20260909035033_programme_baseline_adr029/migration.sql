-- CreateEnum
CREATE TYPE "ProgrammeBaselineStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "programme_baselines" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ProgrammeBaselineStatus" NOT NULL DEFAULT 'APPROVED',
    "approved_by" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL,
    "variation_order_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programme_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programme_baseline_points" (
    "id" TEXT NOT NULL,
    "baseline_id" TEXT NOT NULL,
    "target_date" DATE NOT NULL,
    "cumulative_percent" DECIMAL(6,3) NOT NULL,

    CONSTRAINT "programme_baseline_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "programme_baselines_project_id_status_idx" ON "programme_baselines"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "programme_baselines_project_id_version_key" ON "programme_baselines"("project_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "programme_baseline_points_baseline_id_target_date_key" ON "programme_baseline_points"("baseline_id", "target_date");

-- AddForeignKey
ALTER TABLE "programme_baselines" ADD CONSTRAINT "programme_baselines_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_baselines" ADD CONSTRAINT "programme_baselines_variation_order_id_fkey" FOREIGN KEY ("variation_order_id") REFERENCES "variation_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_baseline_points" ADD CONSTRAINT "programme_baseline_points_baseline_id_fkey" FOREIGN KEY ("baseline_id") REFERENCES "programme_baselines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one APPROVED programme baseline per project, enforced by the database.
--
-- The invariant lives in application code: approve() creates v1 and refuses when one exists;
-- rebaseline() supersedes the current APPROVED row and promotes the next version in one
-- transaction. That is correct, but "which plan is this project measured against?" is the kind
-- of control that must not depend on a single code path — a second writer, a data fix or a
-- future endpoint could otherwise leave two APPROVED baselines with nothing to say which governs.
--
-- A partial unique index is the right shape: it constrains only APPROVED rows, so any number of
-- DRAFT and SUPERSEDED versions coexist as the version history requires. Prisma's schema language
-- cannot express a filtered index, so this is written by hand (mirrors
-- 20260906140000_one_baselined_cost_budget) and `prisma migrate diff` stays clean because an extra
-- index is not a model difference.
CREATE UNIQUE INDEX "programme_baselines_one_approved_per_project"
  ON "programme_baselines" ("project_id")
  WHERE "status" = 'APPROVED';
