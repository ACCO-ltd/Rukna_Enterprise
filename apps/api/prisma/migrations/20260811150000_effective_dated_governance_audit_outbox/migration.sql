-- CEO-approved governance foundation. Policies remain inactive until a formal
-- effective date is assigned and the version is explicitly activated.

CREATE TYPE "WorkflowPolicyStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'SUPERSEDED', 'RETIRED');
CREATE TYPE "WorkflowPolicyRuleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING');
CREATE TYPE "WorkflowAmountBasis" AS ENUM ('NET', 'GROSS', 'UNSPECIFIED');

ALTER TABLE "audit_logs"
  ADD COLUMN "actor_role_context" JSONB,
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "source_command" TEXT,
  ADD COLUMN "approval_instance_id" TEXT,
  ADD COLUMN "correlation_id" TEXT,
  ADD COLUMN "request_id" TEXT;

CREATE TABLE "audit_outbox_events" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "audit_log_id" TEXT NOT NULL,
  "aggregate_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMP(3),
  "publish_attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  CONSTRAINT "audit_outbox_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_outbox_events_audit_log_id_key" UNIQUE ("audit_log_id"),
  CONSTRAINT "audit_outbox_events_idempotency_key_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "audit_outbox_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "audit_outbox_events_organization_id_published_at_occurred_at_idx"
  ON "audit_outbox_events"("organization_id", "published_at", "occurred_at");
CREATE INDEX "audit_outbox_events_aggregate_type_aggregate_id_idx"
  ON "audit_outbox_events"("aggregate_type", "aggregate_id");

CREATE TABLE "workflow_policy_versions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "policy_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "WorkflowPolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "effective_from" TIMESTAMP(3),
  "effective_to" TIMESTAMP(3),
  "reporting_currency" VARCHAR(3) NOT NULL,
  "amount_basis" "WorkflowAmountBasis" NOT NULL DEFAULT 'UNSPECIFIED',
  "notes" TEXT,
  "approved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workflow_policy_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_policy_versions_organization_id_policy_key_version_key" UNIQUE ("organization_id", "policy_key", "version"),
  CONSTRAINT "workflow_policy_versions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "workflow_policy_versions_organization_id_policy_key_status_effective_from_idx"
  ON "workflow_policy_versions"("organization_id", "policy_key", "status", "effective_from");

CREATE TABLE "workflow_policy_rules" (
  "id" TEXT NOT NULL,
  "workflow_policy_version_id" TEXT NOT NULL,
  "rule_key" TEXT NOT NULL,
  "transaction_type" "WorkflowTransactionType",
  "entity_type" TEXT,
  "status" "WorkflowPolicyRuleStatus" NOT NULL DEFAULT 'PENDING',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "configuration" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_policy_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_policy_rules_workflow_policy_version_id_rule_key_key" UNIQUE ("workflow_policy_version_id", "rule_key"),
  CONSTRAINT "workflow_policy_rules_workflow_policy_version_id_fkey"
    FOREIGN KEY ("workflow_policy_version_id") REFERENCES "workflow_policy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "workflow_policy_rules_transaction_type_status_idx"
  ON "workflow_policy_rules"("transaction_type", "status");

CREATE TABLE "segregation_of_duties_rules" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "workflow_policy_version_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "segregation_of_duties_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "segregation_of_duties_rules_organization_id_code_key" UNIQUE ("organization_id", "code"),
  CONSTRAINT "segregation_of_duties_rules_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "segregation_of_duties_rules_workflow_policy_version_id_fkey"
    FOREIGN KEY ("workflow_policy_version_id") REFERENCES "workflow_policy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "segregation_of_duties_rules_organization_id_is_active_idx"
  ON "segregation_of_duties_rules"("organization_id", "is_active");
