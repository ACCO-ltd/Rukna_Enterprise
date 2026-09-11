-- Commercial P0 — rename the vestigial ContractMilestone aggregate to ContractDeliverable.
--
-- DATA-PRESERVING RENAME. The checklist is in use (Eng Ahmed's Q-A fallback: rename, don't drop),
-- so this migration RENAMES the table, column, constraints and indexes in place — it never drops
-- and re-creates them, and no rows are touched. Prisma's default draft for this schema change was a
-- destructive DROP TABLE + CREATE TABLE (and a DROP COLUMN + ADD COLUMN); that draft was replaced by
-- the rename DDL below. The recurring pre-existing Documents drift Prisma folded into the draft
-- (project_documents.updated_at default, project_documents_project_id_idx, and the
-- project_document_revisions index rename) was trimmed out — this migration contains ONLY the
-- ContractMilestone → ContractDeliverable rename.
--
-- After this runs the physical names match exactly what Prisma expects for `model ContractDeliverable`
-- (@@map "contract_deliverables") and `ProgrammeMilestone.contractDeliverableId`
-- (@map "contract_deliverable_id"), so there is no residual drift.

-- 1. Rename the table.
ALTER TABLE "contract_milestones" RENAME TO "contract_deliverables";

-- 2. Rename the table's primary key, index and foreign key to their expected new names.
ALTER TABLE "contract_deliverables" RENAME CONSTRAINT "contract_milestones_pkey" TO "contract_deliverables_pkey";
ALTER INDEX "contract_milestones_contract_id_idx" RENAME TO "contract_deliverables_contract_id_idx";
ALTER TABLE "contract_deliverables" RENAME CONSTRAINT "contract_milestones_contract_id_fkey" TO "contract_deliverables_contract_id_fkey";

-- 3. Rename the nullable FK column on programme_milestones that points INTO this table.
ALTER TABLE "programme_milestones" RENAME COLUMN "contract_milestone_id" TO "contract_deliverable_id";

-- 4. Rename that foreign-key constraint to its expected new name. The constraint keeps its target
--    (now contract_deliverables via the table rename in step 1) and its ON DELETE SET NULL / ON
--    UPDATE CASCADE behaviour; only its identifier changes.
ALTER TABLE "programme_milestones" RENAME CONSTRAINT "programme_milestones_contract_milestone_id_fkey" TO "programme_milestones_contract_deliverable_id_fkey";
