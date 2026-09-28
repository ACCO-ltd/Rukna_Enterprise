-- Progress redesign (2026-09-28): record who returned a daily progress report for revision, and
-- when, alongside the existing return_reason. Nullable: reports returned before this migration keep
-- their reason with no returner recorded.

-- AlterTable
ALTER TABLE "daily_progress_reports" ADD COLUMN     "returned_at" TIMESTAMP(3),
ADD COLUMN     "returned_by" TEXT;
