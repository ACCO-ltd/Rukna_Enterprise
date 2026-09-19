-- The 20260908142810_workpackage_schedule_fields migration was edited after it was applied
-- to the database. The applied version (unrecoverable from git) included DDL that dropped
-- the project_documents project_id index, dropped the updated_at column default, and renamed
-- the project_document_revisions unique index. Those drops conflicted with schema.prisma and
-- were intentionally removed from the migration file. This migration restores the correct
-- schema state on any database that received the erroneous applied version.
-- On a freshly reset database all three statements are no-ops.

-- Restore project_id index on project_documents (dropped by erroneous applied migration)
CREATE INDEX IF NOT EXISTS "project_documents_project_id_idx"
  ON "project_documents"("project_id");

-- Restore updated_at default on project_documents (dropped by erroneous applied migration)
ALTER TABLE "project_documents"
  ALTER COLUMN "updated_at" SET DEFAULT NOW();

-- Rename project_document_revisions unique index back to the schema-expected truncated name.
-- No-op after reset (the erroneous rename target does not exist on a clean replay).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'project_document_revisions_project_document_id_revision_num_key'
  ) THEN
    ALTER INDEX "project_document_revisions_project_document_id_revision_num_key"
      RENAME TO "project_document_revisions_project_document_id_revision_number_";
  END IF;
END $$;
