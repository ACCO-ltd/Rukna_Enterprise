-- Phase 1: Client aggregate, WorkflowRequirementPolicy, Project commercial/participation model,
--           BOQ node measurement method and pricing basis.
-- ADR-005 Sprint 3 Phase 1.

-- ─── New enums ────────────────────────────────────────────────────────────────

CREATE TYPE "CommercialModel" AS ENUM ('CLIENT_CONTRACT', 'INTERNAL_CAPITAL');
CREATE TYPE "ParticipationModel" AS ENUM ('SOLE', 'JOINT_VENTURE');
CREATE TYPE "MeasurementMethod" AS ENUM ('QUANTITY', 'PERCENTAGE', 'MILESTONE');
CREATE TYPE "PricingBasis" AS ENUM ('UNIT_RATE', 'LUMP_SUM');
CREATE TYPE "WorkflowRequirement" AS ENUM ('REQUIRED', 'OPTIONAL', 'NONE');
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- ─── Client aggregate ─────────────────────────────────────────────────────────

CREATE TABLE "clients" (
    "id"               TEXT NOT NULL,
    "organization_id"  TEXT NOT NULL,
    "code"             VARCHAR(30) NOT NULL,
    "name"             TEXT NOT NULL,
    "name_ar"          TEXT,
    "tax_number"       TEXT,
    "default_currency" VARCHAR(3),
    "status"           "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clients_organization_id_fkey" FOREIGN KEY ("organization_id")
        REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "clients_organization_id_code_key" ON "clients"("organization_id", "code");
CREATE INDEX "clients_organization_id_status_idx" ON "clients"("organization_id", "status");

CREATE TABLE "client_contacts" (
    "id"         TEXT NOT NULL,
    "client_id"  TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "role"       TEXT,
    "email"      TEXT,
    "phone"      TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_contacts_client_id_fkey" FOREIGN KEY ("client_id")
        REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "client_contacts_client_id_idx" ON "client_contacts"("client_id");

-- ─── Workflow Requirement Policy ──────────────────────────────────────────────

CREATE TABLE "workflow_requirement_policies" (
    "id"              TEXT NOT NULL,
    "organization_id" TEXT,
    "entity_type"     TEXT NOT NULL,
    "from_state"      TEXT,
    "to_state"        TEXT NOT NULL,
    "requirement"     "WorkflowRequirement" NOT NULL DEFAULT 'OPTIONAL',

    CONSTRAINT "workflow_requirement_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workflow_requirement_policies_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "workflow_requirement_policies_entity_type_to_state_idx"
    ON "workflow_requirement_policies"("entity_type", "to_state");

-- ─── Project extensions ───────────────────────────────────────────────────────

ALTER TABLE "projects"
    ADD COLUMN "commercial_model"    "CommercialModel"    NOT NULL DEFAULT 'CLIENT_CONTRACT',
    ADD COLUMN "participation_model" "ParticipationModel" NOT NULL DEFAULT 'SOLE';

-- ─── BOQ node extensions ──────────────────────────────────────────────────────

ALTER TABLE "boq_nodes"
    ADD COLUMN "measurement_method" "MeasurementMethod" NOT NULL DEFAULT 'QUANTITY',
    ADD COLUMN "pricing_basis"      "PricingBasis"      NOT NULL DEFAULT 'UNIT_RATE';
