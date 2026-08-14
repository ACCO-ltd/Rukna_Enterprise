-- ADR-016 — BOQ workspace contract.
-- CONST-BOQ-013 (one currency), CONST-BOQ-015 (unique codes), CONST-BOQ-017 (dense sibling
-- order), CONST-BOQ-018 (governed baseline + attribution), CONST-BOQ-003 (deactivate).

-- ─── CONST-BOQ-013: the BOQ's unit of account ────────────────────────────────
ALTER TABLE "boqs" ADD COLUMN "currency" VARCHAR(3) NOT NULL DEFAULT 'USD';

-- Seed from the owning project. Projects with no currency set fall back to the column
-- default rather than blocking the migration.
UPDATE "boqs" b
SET "currency" = p."currency"
FROM "projects" p
WHERE p."id" = b."project_id"
  AND p."currency" IS NOT NULL
  AND p."currency" <> '';

-- ─── CONST-BOQ-018: baseline attribution ─────────────────────────────────────
ALTER TABLE "boq_versions"
  ADD COLUMN "derived_from_version_id" TEXT,
  ADD COLUMN "prepared_by"             TEXT,
  ADD COLUMN "submitted_by"            TEXT,
  ADD COLUMN "submitted_at"            TIMESTAMP(3);

-- Existing versions: the creator prepared them. Lineage for historical revisions cannot be
-- reconstructed (it was never recorded), so derived_from_version_id stays null rather than
-- being guessed from version numbering.
UPDATE "boq_versions" SET "prepared_by" = "created_by" WHERE "prepared_by" IS NULL;

-- ─── CONST-BOQ-003: deactivate instead of delete ─────────────────────────────
ALTER TABLE "boq_nodes" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- ─── CONST-BOQ-017: reindex siblings to a dense 0..n-1 sequence ──────────────
-- moveNode never reindexed, so ties were storable and read order was undefined. Normalise
-- before the constraint goes on. Ordering by (sort_order, created_at, id) keeps the current
-- displayed order stable and breaks any tie deterministically.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "version_id", "parent_id"
           ORDER BY "sort_order", "created_at", "id"
         ) - 1 AS new_order
  FROM "boq_nodes"
)
UPDATE "boq_nodes" n
SET "sort_order" = ranked.new_order
FROM ranked
WHERE n."id" = ranked."id"
  AND n."sort_order" <> ranked.new_order;

CREATE UNIQUE INDEX "boq_nodes_version_id_parent_id_sort_order_key"
  ON "boq_nodes" ("version_id", "parent_id", "sort_order");

-- Postgres treats NULLs as distinct in a unique index, so the constraint above does not
-- cover root nodes. A partial index does.
CREATE UNIQUE INDEX "boq_nodes_version_root_sort_order_key"
  ON "boq_nodes" ("version_id", "sort_order")
  WHERE "parent_id" IS NULL;

-- ─── CONST-BOQ-015: unique code within a version ─────────────────────────────
CREATE UNIQUE INDEX "boq_nodes_version_id_code_key"
  ON "boq_nodes" ("version_id", "code");

-- ─── CONST-BOQ-018: BOQ baselining is a governable transaction ───────────────
ALTER TYPE "WorkflowTransactionType" ADD VALUE 'BOQ_BASELINE';
