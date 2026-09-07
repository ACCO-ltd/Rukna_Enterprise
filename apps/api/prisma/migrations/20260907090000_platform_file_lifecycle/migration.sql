-- Phase 7 Step 2 — PlatformFile lifecycle.
--
-- `immutable BOOLEAN` was a two-state field for a three-state problem, and nothing ever set it
-- to true (`markImmutable()` had no caller), so every file in the system was deletable. It is
-- replaced by an explicit lifecycle:
--
--   TEMPORARY  uploaded, bound to nothing. Reapable after the retention window.
--   BOUND      attached to a business record whose workflow may still legitimately replace it.
--   IMMUTABLE  the owning record reached a finalised state. No hard delete, ever.
--
-- The backfill classifies existing rows from what actually references them, rather than
-- defaulting everything to TEMPORARY and having the next cleanup run delete live evidence.

CREATE TYPE "PlatformFileLifecycle" AS ENUM ('TEMPORARY', 'BOUND', 'IMMUTABLE');

ALTER TABLE "platform_files"
  ADD COLUMN "lifecycle" "PlatformFileLifecycle" NOT NULL DEFAULT 'TEMPORARY',
  ADD COLUMN "bound_at" TIMESTAMP(3),
  ADD COLUMN "lifecycle_reason" VARCHAR(120);

-- Bound: referenced by a project document (no finalisation event exists for the register yet)
-- or by the evidence on a report that is still open.
UPDATE "platform_files" f
   SET "lifecycle" = 'BOUND', "bound_at" = f."created_at",
       "lifecycle_reason" = 'backfill: referenced by project_documents'
 WHERE EXISTS (SELECT 1 FROM "project_documents" d WHERE d."platform_file_id" = f."id");

UPDATE "platform_files" f
   SET "lifecycle" = 'BOUND', "bound_at" = f."created_at",
       "lifecycle_reason" = 'backfill: referenced by dpr_attachments'
 WHERE EXISTS (SELECT 1 FROM "dpr_attachments" a WHERE a."platform_file_id" = f."id")
   AND f."lifecycle" = 'TEMPORARY';

-- Immutable: evidence behind an APPROVED daily progress report. CONST-PROG-008 makes approval
-- the point at which measurements become verified, so the evidence that supported it is part of
-- the record from then on. A REOPENED report appends new evidence; it does not release the old.
UPDATE "platform_files" f
   SET "lifecycle" = 'IMMUTABLE',
       "lifecycle_reason" = 'backfill: evidence on an APPROVED daily progress report'
 WHERE EXISTS (
   SELECT 1 FROM "dpr_attachments" a
     JOIN "daily_progress_reports" r ON r."id" = a."dpr_id"
    WHERE a."platform_file_id" = f."id" AND r."status" = 'APPROVED'
 );

-- Anything the old boolean did mark stays marked. (Nothing does today — the guard never had a
-- caller — but a migration that silently downgrades a protected file is not one worth writing.)
UPDATE "platform_files" SET "lifecycle" = 'IMMUTABLE',
       "lifecycle_reason" = COALESCE("lifecycle_reason", 'backfill: legacy immutable flag')
 WHERE "immutable" = true AND "lifecycle" <> 'IMMUTABLE';

ALTER TABLE "platform_files" DROP COLUMN "immutable";

-- The cleanup sweep's query: TEMPORARY files older than the retention window.
CREATE INDEX "platform_files_lifecycle_created_at_idx"
    ON "platform_files" ("lifecycle", "created_at");
