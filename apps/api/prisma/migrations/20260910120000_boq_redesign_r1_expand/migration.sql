-- ADR-029 (BOQ workspace redesign) R1 — the EXPAND phase.
--
-- The BOQ becomes one long-lived operational version edited in place (COMMITTED) with immutable
-- frozen copies (SNAPSHOT) at commit and at each variation adopt; a node gains a WORK/CONTINGENCY
-- role and a client-money treatment; a contract gains a frozen BASE value that drives the milestone
-- percentage schedule (which never re-spreads on a variation).
--
-- This migration is PURELY ADDITIVE and backward-compatible: new enums, new defaulted columns, new
-- nullable pointers backfilled from the columns that already exist. It destroys no data and mints no
-- new ids, so every downstream reference (progress, procurement, cost, IPA) keeps resolving, and
-- BASELINED keeps meaning exactly what it always did.
--
-- The CONTRACT phase — flipping existing BASELINED versions to COMMITTED + a SNAPSHOT copy and
-- retiring the three old Boq pointers — lands with R2's lifecycle switch, behind a production-clone
-- dry-run.
--
-- NOTE: two BoqVersionStatus values are added in one migration; this requires PostgreSQL 12+
-- (verify in the dry-run). The new values are not used elsewhere in this migration.

-- CreateEnum
CREATE TYPE "NodeRole" AS ENUM ('WORK', 'CONTINGENCY');

-- CreateEnum
CREATE TYPE "CommercialTreatment" AS ENUM ('IN_CONTRACT', 'SEPARATE_CHARGE', 'ABSORBED');

-- AlterEnum
ALTER TYPE "BoqVersionStatus" ADD VALUE 'COMMITTED';
ALTER TYPE "BoqVersionStatus" ADD VALUE 'SNAPSHOT';

-- AlterTable — Boq operational + committed-snapshot pointers (the old three pointers stay through the expand phase)
ALTER TABLE "boqs" ADD COLUMN     "committed_snapshot_version_id" TEXT,
ADD COLUMN     "current_version_id" TEXT;

-- AlterTable — BoqNode WORK/CONTINGENCY role + client-money treatment (the defaults ARE the backfill)
ALTER TABLE "boq_nodes" ADD COLUMN     "commercial_treatment" "CommercialTreatment" NOT NULL DEFAULT 'IN_CONTRACT',
ADD COLUMN     "node_role" "NodeRole" NOT NULL DEFAULT 'WORK';

-- AlterTable — Contract frozen base value (drives the milestone schedule)
ALTER TABLE "contracts" ADD COLUMN     "base_contract_value" DECIMAL(18,2);

-- Backfill — the new pointers/value mirror today's reality without changing any behaviour.
UPDATE "contracts" SET "base_contract_value" = "contract_value" WHERE "base_contract_value" IS NULL;
UPDATE "boqs" SET "current_version_id" = COALESCE("current_draft_version_id", "current_approved_version_id") WHERE "current_version_id" IS NULL;
UPDATE "boqs" SET "committed_snapshot_version_id" = "current_approved_version_id" WHERE "committed_snapshot_version_id" IS NULL;
