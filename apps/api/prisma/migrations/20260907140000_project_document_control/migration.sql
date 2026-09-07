-- Phase 7A - Project document control.
--
-- `project_documents` was a file list: one row, one file, no status, no revision, no dates, no
-- number. Replacing a drawing meant replacing the row, which destroyed the revision it replaced.
--
-- This turns it into a controlled register:
--
--   project_documents            the controlled record - identity, lifecycle, validity, responsibility
--   project_document_revisions   append-only issues, and the only holder of a file
--
-- Everything that exists today is preserved. Every existing row becomes one document plus one
-- revision holding the file it used to hold directly.

-- --------------------------------------------------------------------------------------------
-- 1. New enums.
-- --------------------------------------------------------------------------------------------

CREATE TYPE "ProjectDocumentStatus" AS ENUM ('DRAFT', 'ISSUED', 'SUPERSEDED', 'WITHDRAWN', 'ARCHIVED');
CREATE TYPE "DocumentRevisionStatus" AS ENUM ('DRAFT', 'ISSUED', 'SUPERSEDED', 'WITHDRAWN');
CREATE TYPE "DocumentRevisionPurpose" AS ENUM ('FOR_REVIEW', 'FOR_APPROVAL', 'ISSUED_FOR_CONSTRUCTION', 'AS_BUILT');
CREATE TYPE "DocumentDiscipline" AS ENUM (
  'ARCHITECTURAL', 'STRUCTURAL', 'CIVIL', 'MECHANICAL', 'ELECTRICAL', 'PLUMBING',
  'FIRE_PROTECTION', 'HSE', 'QUALITY', 'COMMERCIAL', 'GENERAL'
);

-- --------------------------------------------------------------------------------------------
-- 2. Category taxonomy migration.
--
-- The old enum had ten values for a taxonomy that was never a controlled-document taxonomy:
-- PERMIT and LICENSE were two values for one instrument class, and PHOTO is not a controlled
-- document at all - a site photo is DPR evidence and reads under Linked Attachments.
--
-- Migrated in place rather than added beside, so the platform has ONE document taxonomy.
-- --------------------------------------------------------------------------------------------

CREATE TYPE "DocumentCategory_new" AS ENUM (
  'DRAWING', 'CONTRACT', 'PERMIT_LICENSE', 'GUARANTEE_BOND', 'INSURANCE',
  'TECHNICAL_SUBMITTAL', 'METHOD_STATEMENT', 'QUALITY_TEST_CERTIFICATE',
  'CORRESPONDENCE_INSTRUCTION', 'HANDOVER', 'OTHER_CONTROLLED'
);

ALTER TABLE "project_documents"
  ALTER COLUMN "category" TYPE "DocumentCategory_new"
  USING (
    CASE "category"::text
      WHEN 'PERMIT'         THEN 'PERMIT_LICENSE'
      WHEN 'LICENSE'        THEN 'PERMIT_LICENSE'
      WHEN 'DRAWING'        THEN 'DRAWING'
      WHEN 'CONTRACT'       THEN 'CONTRACT'
      WHEN 'CERTIFICATE'    THEN 'QUALITY_TEST_CERTIFICATE'
      WHEN 'INSURANCE'      THEN 'INSURANCE'
      WHEN 'GUARANTEE'      THEN 'GUARANTEE_BOND'
      WHEN 'CORRESPONDENCE' THEN 'CORRESPONDENCE_INSTRUCTION'
      -- A photo was never a controlled document. It keeps its file and its place in the register
      -- rather than being deleted; someone with the project in front of them can reclassify it.
      WHEN 'PHOTO'          THEN 'OTHER_CONTROLLED'
      ELSE 'OTHER_CONTROLLED'
    END
  )::"DocumentCategory_new";

DROP TYPE "DocumentCategory";
ALTER TYPE "DocumentCategory_new" RENAME TO "DocumentCategory";

-- --------------------------------------------------------------------------------------------
-- 3. The revision table.
-- --------------------------------------------------------------------------------------------

CREATE TABLE "project_document_revisions" (
  "id"                  TEXT NOT NULL,
  "organization_id"     TEXT NOT NULL,
  "project_document_id" TEXT NOT NULL,
  "platform_file_id"    TEXT NOT NULL,
  "revision_number"     INTEGER NOT NULL,
  "revision_code"       VARCHAR(20),
  "status"              "DocumentRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  "purpose"             "DocumentRevisionPurpose",
  "notes"               VARCHAR(300),
  "issued_at"           TIMESTAMP(3),
  "issued_by"           TEXT,
  "superseded_at"       TIMESTAMP(3),
  "withdrawn_at"        TIMESTAMP(3),
  "withdrawn_by"        TEXT,
  "created_by"          TEXT NOT NULL,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_document_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_document_revisions_project_document_id_revision_number_key"
    ON "project_document_revisions" ("project_document_id", "revision_number");
CREATE INDEX "project_document_revisions_project_document_id_status_idx"
    ON "project_document_revisions" ("project_document_id", "status");
CREATE INDEX "project_document_revisions_platform_file_id_idx"
    ON "project_document_revisions" ("platform_file_id");

-- The two invariants that make "the draft" and "the current revision" unambiguous. Application
-- code enforces them too, but a filtered unique index is what makes them true under concurrency -
-- the cost budget's one-BASELINED rule learned this the expensive way.
CREATE UNIQUE INDEX "project_document_revisions_one_draft"
    ON "project_document_revisions" ("project_document_id") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "project_document_revisions_one_issued"
    ON "project_document_revisions" ("project_document_id") WHERE "status" = 'ISSUED';

-- --------------------------------------------------------------------------------------------
-- 4. New columns on the register.
--
-- `document_number` is required, and legacy rows have none. It is filled with DOC-0001, DOC-0002 …
-- per project in creation order: a real, editable, unique identity rather than a guess at what the
-- number "should" have been. Anyone with the document in front of them can correct it while the
-- record is still DRAFT.
-- --------------------------------------------------------------------------------------------

ALTER TABLE "project_documents"
  ADD COLUMN "document_number"            VARCHAR(60),
  ADD COLUMN "document_number_normalized" VARCHAR(60),
  ADD COLUMN "discipline"                 "DocumentDiscipline",
  ADD COLUMN "status"                     "ProjectDocumentStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "responsible_user_id"        TEXT,
  ADD COLUMN "issuer_name"                VARCHAR(120),
  ADD COLUMN "issued_at"                  DATE,
  ADD COLUMN "valid_from"                 DATE,
  ADD COLUMN "expires_at"                 DATE,
  ADD COLUMN "current_revision_id"        TEXT,
  ADD COLUMN "superseded_by_document_id"  TEXT,
  ADD COLUMN "superseded_at"              TIMESTAMP(3),
  ADD COLUMN "withdrawn_at"               TIMESTAMP(3),
  ADD COLUMN "withdrawn_by"               TEXT,
  ADD COLUMN "withdrawn_reason"           VARCHAR(300),
  ADD COLUMN "archived_at"                TIMESTAMP(3),
  ADD COLUMN "archived_by"                TEXT,
  ADD COLUMN "created_by"                 TEXT,
  ADD COLUMN "updated_at"                 TIMESTAMP(3);

-- Title was unconstrained TEXT; the register now bounds it so a pasted document body cannot
-- become a title. Existing titles are far shorter than this, but truncate defensively rather
-- than let the ALTER fail on a single pathological row.
UPDATE "project_documents" SET "title" = LEFT("title", 200) WHERE LENGTH("title") > 200;
ALTER TABLE "project_documents" ALTER COLUMN "title" TYPE VARCHAR(200);

-- --------------------------------------------------------------------------------------------
-- 5. Backfill: every existing row becomes a document + its first revision.
--
-- Status DRAFT, not ISSUED. Nothing ever issued these - the old register had no issuance event -
-- so calling them issued would fabricate a control that never ran, and would freeze their files
-- as immutable evidence of a decision nobody took. DRAFT is the honest state, and it matches the
-- files' existing BOUND lifecycle from the Step 2 backfill.
-- --------------------------------------------------------------------------------------------

WITH numbered AS (
  SELECT "id",
         'DOC-' || LPAD(
           (ROW_NUMBER() OVER (PARTITION BY "project_id" ORDER BY "created_at", "id"))::text, 4, '0'
         ) AS "number"
    FROM "project_documents"
)
UPDATE "project_documents" d
   SET "document_number"            = n."number",
       "document_number_normalized" = n."number",
       "created_by"                 = d."uploaded_by",
       "updated_at"                 = d."created_at"
  FROM numbered n
 WHERE n."id" = d."id";

INSERT INTO "project_document_revisions" (
  "id", "organization_id", "project_document_id", "platform_file_id",
  "revision_number", "status", "created_by", "created_at"
)
SELECT d."id" || '-r1', d."organization_id", d."id", d."platform_file_id",
       1, 'DRAFT', d."uploaded_by", d."created_at"
  FROM "project_documents" d;

UPDATE "project_documents" d
   SET "current_revision_id" = d."id" || '-r1';

-- --------------------------------------------------------------------------------------------
-- 6. Lock the new shape in, and drop what the revision now owns.
-- --------------------------------------------------------------------------------------------

ALTER TABLE "project_documents"
  ALTER COLUMN "document_number"            SET NOT NULL,
  ALTER COLUMN "document_number_normalized" SET NOT NULL,
  ALTER COLUMN "created_by"                 SET NOT NULL,
  ALTER COLUMN "updated_at"                 SET NOT NULL,
  ALTER COLUMN "updated_at"                 SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "project_documents"
  DROP COLUMN "platform_file_id",
  DROP COLUMN "uploaded_by";

CREATE UNIQUE INDEX "project_documents_project_id_document_number_normalized_key"
    ON "project_documents" ("project_id", "document_number_normalized");
CREATE UNIQUE INDEX "project_documents_current_revision_id_key"
    ON "project_documents" ("current_revision_id");
CREATE INDEX "project_documents_project_id_status_idx"
    ON "project_documents" ("project_id", "status");
CREATE INDEX "project_documents_project_id_category_idx"
    ON "project_documents" ("project_id", "category");
CREATE INDEX "project_documents_organization_id_expires_at_idx"
    ON "project_documents" ("organization_id", "expires_at");

ALTER TABLE "project_document_revisions"
  ADD CONSTRAINT "project_document_revisions_project_document_id_fkey"
  FOREIGN KEY ("project_document_id") REFERENCES "project_documents" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_document_revisions"
  ADD CONSTRAINT "project_document_revisions_platform_file_id_fkey"
  FOREIGN KEY ("platform_file_id") REFERENCES "platform_files" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_documents"
  ADD CONSTRAINT "project_documents_current_revision_id_fkey"
  FOREIGN KEY ("current_revision_id") REFERENCES "project_document_revisions" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_documents"
  ADD CONSTRAINT "project_documents_superseded_by_document_id_fkey"
  FOREIGN KEY ("superseded_by_document_id") REFERENCES "project_documents" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- --------------------------------------------------------------------------------------------
-- 7. IPC attachment purpose.
--
-- The issued certificate and the working evidence behind it were indistinguishable rows. They
-- have different freeze rules, so they cannot share a state. Existing rows (there are none - the
-- table has never had code behind it) default to SUPPORTING, the weaker claim.
-- --------------------------------------------------------------------------------------------

CREATE TYPE "IpcAttachmentPurpose" AS ENUM ('SUPPORTING', 'ISSUED_CERTIFICATE');

ALTER TABLE "ipc_attachments"
  ADD COLUMN "purpose" "IpcAttachmentPurpose" NOT NULL DEFAULT 'SUPPORTING';
