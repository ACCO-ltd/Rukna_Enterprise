-- Phase 2: membership model + workflow trigger binding + make transactionType nullable

-- New enums
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');
CREATE TYPE "WorkflowTriggerKind" AS ENUM ('DOCUMENT', 'STATE_TRANSITION');

-- Allow WorkflowDefinition and ApprovalInstance to exist without a document transaction type
-- (used by state-transition workflow definitions)
ALTER TABLE "workflow_definitions" ALTER COLUMN "transaction_type" DROP NOT NULL;
ALTER TABLE "approval_instances" ALTER COLUMN "transaction_type" DROP NOT NULL;

-- organization_memberships
CREATE TABLE "organization_memberships" (
    "id"              TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id"         TEXT NOT NULL,
    "status"          "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_default"      BOOLEAN NOT NULL DEFAULT false,
    "joined_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at"      TIMESTAMP(3),
    "removed_by"      TEXT,
    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_memberships_organization_id_user_id_key"
    ON "organization_memberships"("organization_id", "user_id");
CREATE INDEX "organization_memberships_user_id_status_idx"
    ON "organization_memberships"("user_id", "status");

ALTER TABLE "organization_memberships"
    ADD CONSTRAINT "organization_memberships_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_memberships"
    ADD CONSTRAINT "organization_memberships_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill memberships from existing User.organization_id assignments
-- This seeds one ACTIVE membership per user so existing users retain access
-- after the JWT guard begins validating OrganizationMembership.
INSERT INTO "organization_memberships" ("id", "organization_id", "user_id", "status", "is_default", "joined_at")
SELECT
    gen_random_uuid()::text,
    u."organization_id",
    u."id",
    'ACTIVE',
    true,
    CURRENT_TIMESTAMP
FROM "users" u
WHERE u."organization_id" IS NOT NULL
ON CONFLICT ("organization_id", "user_id") DO NOTHING;

-- organization_membership_roles
CREATE TABLE "organization_membership_roles" (
    "id"            TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "role_id"       TEXT NOT NULL,
    "assigned_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by"   TEXT NOT NULL,
    "removed_at"    TIMESTAMP(3),
    CONSTRAINT "organization_membership_roles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "organization_membership_roles_membership_id_idx"
    ON "organization_membership_roles"("membership_id");

ALTER TABLE "organization_membership_roles"
    ADD CONSTRAINT "organization_membership_roles_membership_id_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "organization_memberships"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_membership_roles"
    ADD CONSTRAINT "organization_membership_roles_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "roles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- workflow_trigger_bindings
CREATE TABLE "workflow_trigger_bindings" (
    "id"                     TEXT NOT NULL,
    "organization_id"        TEXT,
    "trigger_kind"           "WorkflowTriggerKind" NOT NULL,
    "entity_type"            TEXT NOT NULL,
    "transaction_type"       "WorkflowTransactionType",
    "from_state"             TEXT,
    "to_state"               TEXT,
    "workflow_definition_id" TEXT NOT NULL,
    "priority"               INTEGER NOT NULL DEFAULT 0,
    "is_active"              BOOLEAN NOT NULL DEFAULT false,
    "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workflow_trigger_bindings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workflow_trigger_bindings_org_kind_entity_tostate_idx"
    ON "workflow_trigger_bindings"("organization_id", "trigger_kind", "entity_type", "to_state");

ALTER TABLE "workflow_trigger_bindings"
    ADD CONSTRAINT "workflow_trigger_bindings_workflow_definition_id_fkey"
    FOREIGN KEY ("workflow_definition_id") REFERENCES "workflow_definitions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
