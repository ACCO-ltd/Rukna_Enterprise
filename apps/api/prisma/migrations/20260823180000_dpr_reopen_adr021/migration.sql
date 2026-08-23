-- ADR-021 CONST-PROG-010 — controlled, authorised, audited reopen of an APPROVED daily progress
-- report for correction. Reopened reports are editable/re-submittable, and their measurements do
-- not count as verified until re-approval.
ALTER TYPE "DprStatus" ADD VALUE 'REOPENED';

ALTER TABLE "daily_progress_reports" ADD COLUMN "reopened_by" TEXT;
ALTER TABLE "daily_progress_reports" ADD COLUMN "reopened_at" TIMESTAMP(3);
ALTER TABLE "daily_progress_reports" ADD COLUMN "reopen_reason" TEXT;
