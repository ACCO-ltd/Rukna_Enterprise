-- CreateEnum
CREATE TYPE "ContractKind" AS ENUM ('CLIENT_CONTRACT', 'SUBCONTRACT');

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "contract_kind" "ContractKind" NOT NULL DEFAULT 'CLIENT_CONTRACT';

-- RenameIndex
ALTER INDEX "audit_outbox_events_organization_id_published_at_occurred_at_id" RENAME TO "audit_outbox_events_organization_id_published_at_occurred_a_idx";

-- RenameIndex
ALTER INDEX "workflow_policy_versions_organization_id_policy_key_status_effe" RENAME TO "workflow_policy_versions_organization_id_policy_key_status__idx";
