-- ADR-021 CONST-PROG-011 — the approved planned-progress curve (ACCO's monthly milestones): the
-- cumulative % expected by each target date on the baseline programme. Drives "planned today" and
-- the planned-vs-verified schedule-variance signal.
CREATE TABLE "progress_targets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "target_date" DATE NOT NULL,
    "cumulative_percent" DECIMAL(6,3) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "progress_targets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "progress_targets_project_id_target_date_key" ON "progress_targets"("project_id", "target_date");
CREATE INDEX "progress_targets_project_id_target_date_idx" ON "progress_targets"("project_id", "target_date");
ALTER TABLE "progress_targets" ADD CONSTRAINT "progress_targets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
