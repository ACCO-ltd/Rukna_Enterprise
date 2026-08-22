-- ADR-019 CONST-PLC-001: collapse ProjectStatus from eight states to six canonical ones.
-- APPROVED retires into a workflow authorization event; MOBILIZING retires into readiness
-- work performed while DRAFT. Any project currently sitting in APPROVED or MOBILIZING folds
-- back into DRAFT (presented as "Preparation" in the UI, CONST-PLC-010).
--
-- History is NOT lost: the moment each project was approved or began mobilizing is preserved
-- in audit_events (PROJECT_APPROVE / PROJECT_MOBILIZE, recorded when the transition happened).
-- This migration only rewrites the current lifecycle state, never the transition trail.

UPDATE "projects" SET "status" = 'DRAFT' WHERE "status" IN ('APPROVED', 'MOBILIZING');

-- Postgres cannot drop a value from an enum in place, so the type is recreated.
ALTER TYPE "ProjectStatus" RENAME TO "ProjectStatus_old";
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PRACTICAL_COMPLETION', 'CLOSEOUT', 'CLOSED', 'CANCELLED');
ALTER TABLE "projects" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "projects" ALTER COLUMN "status" TYPE "ProjectStatus" USING ("status"::text::"ProjectStatus");
ALTER TABLE "projects" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "ProjectStatus_old";
