-- Round-2 Progress-over-time (BE-1) — an immutable, frozen progress reading for a project at a
-- period-end date. Freezes what ADR-021 already computes (weighted physical roll-up,
-- verified-to-date, cost-consumed from the physical-vs-financial signal). Immutable once written:
-- progress may be restated via a DPR reopen (ADR-021 CONST-PROG-010), so a snapshot is the
-- auditable "as reported" record and is never recomputed. One snapshot per project per period.

-- CreateEnum
CREATE TYPE "ProgressSnapshotSource" AS ENUM ('MANUAL', 'PERIOD_CLOSE');

-- CreateTable
CREATE TABLE "progress_snapshots" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "period_end_date" DATE NOT NULL,
    "accounting_period_id" TEXT,
    "physical_percent" DECIMAL(6,3) NOT NULL,
    "verified_percent" DECIMAL(6,3) NOT NULL,
    "cost_consumed_percent" DECIMAL(6,3),
    "source" "ProgressSnapshotSource" NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "captured_by_id" TEXT NOT NULL,
    CONSTRAINT "progress_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "progress_snapshots_project_id_period_end_date_key" ON "progress_snapshots"("project_id", "period_end_date");

-- CreateIndex
CREATE INDEX "progress_snapshots_project_id_period_end_date_idx" ON "progress_snapshots"("project_id", "period_end_date");

-- AddForeignKey
ALTER TABLE "progress_snapshots" ADD CONSTRAINT "progress_snapshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
