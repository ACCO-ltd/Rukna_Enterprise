-- ADR-014: shared PlatformFile store + wire the five *Attachment FKs.

-- Enum. Guarded because a prior partial migration attempt may have left the type behind.
DO $$ BEGIN
  CREATE TYPE "PlatformFileStatus" AS ENUM ('PENDING', 'READY');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE "platform_files" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum_sha256" TEXT,
    "storage_bucket" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "PlatformFileStatus" NOT NULL DEFAULT 'PENDING',
    "immutable" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "platform_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_files_storage_key_key" ON "platform_files"("storage_key");
CREATE INDEX "platform_files_organization_id_idx" ON "platform_files"("organization_id");

-- Back-fill placeholder PlatformFile rows for pre-existing attachment references (Sprint-5 join rows
-- whose bytes were never stored). We create a placeholder rather than delete the attachment, because
-- audit-relevant attachments (e.g. POSTED journal entries) are immutable and must not be removed.
-- The placeholder is marked immutable with no checksum/bytes: an honest "metadata exists, file never
-- captured." No-op on any environment that already has real files.
INSERT INTO "platform_files" (
  "id", "organization_id", "original_name", "mime_type", "size_bytes",
  "storage_bucket", "storage_key", "status", "immutable", "uploaded_by", "created_at"
)
SELECT DISTINCT a."platform_file_id", 'LEGACY', 'legacy-attachment', 'application/octet-stream', 0,
       'legacy', 'legacy/' || a."platform_file_id", 'PENDING'::"PlatformFileStatus", true, 'system', CURRENT_TIMESTAMP
FROM (
  SELECT "platform_file_id" FROM "contract_attachments"
  UNION SELECT "platform_file_id" FROM "guarantee_attachments"
  UNION SELECT "platform_file_id" FROM "ipa_attachments"
  UNION SELECT "platform_file_id" FROM "ipc_attachments"
  UNION SELECT "platform_file_id" FROM "journal_entry_attachments"
) a
WHERE a."platform_file_id" NOT IN (SELECT "id" FROM "platform_files");

-- AddForeignKey
ALTER TABLE "contract_attachments" ADD CONSTRAINT "contract_attachments_platform_file_id_fkey" FOREIGN KEY ("platform_file_id") REFERENCES "platform_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guarantee_attachments" ADD CONSTRAINT "guarantee_attachments_platform_file_id_fkey" FOREIGN KEY ("platform_file_id") REFERENCES "platform_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ipa_attachments" ADD CONSTRAINT "ipa_attachments_platform_file_id_fkey" FOREIGN KEY ("platform_file_id") REFERENCES "platform_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ipc_attachments" ADD CONSTRAINT "ipc_attachments_platform_file_id_fkey" FOREIGN KEY ("platform_file_id") REFERENCES "platform_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entry_attachments" ADD CONSTRAINT "journal_entry_attachments_platform_file_id_fkey" FOREIGN KEY ("platform_file_id") REFERENCES "platform_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
