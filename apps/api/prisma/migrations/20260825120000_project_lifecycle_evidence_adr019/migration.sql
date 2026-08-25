-- ADR-019 Phase B2 CONST-PLC-008 — evidence a lifecycle command records (the decision it
-- introduces): Start records the actual commencement, Close records the closure decision. All
-- nullable so the migration does not backfill legacy rows.
ALTER TABLE "projects" ADD COLUMN "actual_start_date" DATE;
ALTER TABLE "projects" ADD COLUMN "commencement_note" TEXT;
ALTER TABLE "projects" ADD COLUMN "closure_date" DATE;
ALTER TABLE "projects" ADD COLUMN "closure_summary" TEXT;
