-- Progress redesign (2026-09-28): record when each DPR work entry was created, so a REOPENED report
-- can tell the entries that were approved (created before the reopen — protected, CONST-PROG-010
-- supersede, don't overwrite) from corrections added since (deletable).
--
-- Existing rows are backfilled from their report's created_at, which is never later than any reopen
-- of that report — so every pre-existing entry stays protected. New rows default to now().

-- AlterTable
ALTER TABLE "progress_measurements" ADD COLUMN "created_at" TIMESTAMP(3);

UPDATE "progress_measurements" AS m
SET "created_at" = d."created_at"
FROM "daily_progress_reports" AS d
WHERE d."id" = m."dpr_id";

ALTER TABLE "progress_measurements"
  ALTER COLUMN "created_at" SET NOT NULL,
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
