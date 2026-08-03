-- Phase 2: Contract module — contracts, sub-entities, attachment join tables

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE "ContractStatus" AS ENUM (
  'DRAFT',
  'UNDER_REVIEW',
  'PENDING_SIGNATURE',
  'ACTIVE',
  'FINAL_ACCOUNT_PENDING',
  'CLOSED',
  'CANCELLED',
  'TERMINATED'
);

CREATE TYPE "BillingModel" AS ENUM (
  'MEASURED_IPC',
  'MILESTONE',
  'TIME_AND_MATERIAL',
  'HYBRID'
);

CREATE TYPE "AdvanceType" AS ENUM (
  'MOBILIZATION',
  'MATERIAL_ON_SITE',
  'EQUIPMENT',
  'OTHER'
);

CREATE TYPE "GuaranteeStatus" AS ENUM (
  'ACTIVE',
  'DISCHARGED',
  'EXPIRED',
  'CALLED'
);

-- ─── contracts ────────────────────────────────────────────────────────────────

CREATE TABLE "contracts" (
  "id"                    TEXT        NOT NULL,
  "project_id"            TEXT        NOT NULL,
  "organization_id"       TEXT        NOT NULL,
  "client_id"             TEXT        NOT NULL,
  "boq_version_id"        TEXT        NOT NULL,
  "contract_number"       VARCHAR(50) NOT NULL,
  "contract_value"        DECIMAL(18,2) NOT NULL,
  "currency"              VARCHAR(3)  NOT NULL,
  "billing_model"         "BillingModel" NOT NULL DEFAULT 'MEASURED_IPC',
  "status"                "ContractStatus" NOT NULL DEFAULT 'DRAFT',
  "client_name_snapshot"  TEXT,
  "client_tax_snapshot"   TEXT,
  "start_date"            DATE,
  "expected_end_date"     DATE,
  "created_by"            TEXT        NOT NULL,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "contracts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contracts_organization_id_contract_number_key" UNIQUE ("organization_id", "contract_number")
);

CREATE INDEX "contracts_project_id_status_idx" ON "contracts" ("project_id", "status");
CREATE INDEX "contracts_client_id_idx" ON "contracts" ("client_id");

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── contract_retention_terms ─────────────────────────────────────────────────

CREATE TABLE "contract_retention_terms" (
  "contract_id"             TEXT         NOT NULL,
  "retention_rate"          DECIMAL(5,4) NOT NULL,
  "retention_cap"           DECIMAL(5,4) NOT NULL,
  "retention_split_on_pc"   DECIMAL(5,4) NOT NULL,
  "retention_released_at"   TIMESTAMP(3),

  CONSTRAINT "contract_retention_terms_pkey" PRIMARY KEY ("contract_id")
);

ALTER TABLE "contract_retention_terms" ADD CONSTRAINT "contract_retention_terms_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── contract_advance_terms ───────────────────────────────────────────────────

CREATE TABLE "contract_advance_terms" (
  "id"            TEXT         NOT NULL,
  "contract_id"   TEXT         NOT NULL,
  "advance_type"  "AdvanceType" NOT NULL,
  "description"   TEXT,
  "amount"        DECIMAL(18,2),
  "percentage"    DECIMAL(5,4),
  "recovery_rate" DECIMAL(5,4) NOT NULL,

  CONSTRAINT "contract_advance_terms_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_advance_terms_contract_id_idx" ON "contract_advance_terms" ("contract_id");

ALTER TABLE "contract_advance_terms" ADD CONSTRAINT "contract_advance_terms_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── contract_guarantees ──────────────────────────────────────────────────────

CREATE TABLE "contract_guarantees" (
  "id"              TEXT              NOT NULL,
  "contract_id"     TEXT              NOT NULL,
  "guarantee_type"  TEXT              NOT NULL,
  "amount"          DECIMAL(18,2)     NOT NULL,
  "currency"        VARCHAR(3)        NOT NULL,
  "issuer"          TEXT              NOT NULL,
  "beneficiary"     TEXT              NOT NULL,
  "issue_date"      DATE              NOT NULL,
  "expiry_date"     DATE              NOT NULL,
  "status"          "GuaranteeStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes"           TEXT,

  CONSTRAINT "contract_guarantees_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_guarantees_contract_id_idx" ON "contract_guarantees" ("contract_id");
CREATE INDEX "contract_guarantees_expiry_date_status_idx" ON "contract_guarantees" ("expiry_date", "status");

ALTER TABLE "contract_guarantees" ADD CONSTRAINT "contract_guarantees_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── contract_milestones ──────────────────────────────────────────────────────

CREATE TABLE "contract_milestones" (
  "id"            TEXT         NOT NULL,
  "contract_id"   TEXT         NOT NULL,
  "name"          TEXT         NOT NULL,
  "description"   TEXT,
  "due_date"      DATE,
  "completed_at"  TIMESTAMP(3),
  "completed_by"  TEXT,
  "sort_order"    INTEGER      NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contract_milestones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_milestones_contract_id_idx" ON "contract_milestones" ("contract_id");

ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── contract_attachments ─────────────────────────────────────────────────────

CREATE TABLE "contract_attachments" (
  "id"                TEXT         NOT NULL,
  "contract_id"       TEXT         NOT NULL,
  "platform_file_id"  TEXT         NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"        TEXT         NOT NULL,

  CONSTRAINT "contract_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_attachments_contract_id_idx" ON "contract_attachments" ("contract_id");

ALTER TABLE "contract_attachments" ADD CONSTRAINT "contract_attachments_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── guarantee_attachments ────────────────────────────────────────────────────

CREATE TABLE "guarantee_attachments" (
  "id"                TEXT         NOT NULL,
  "guarantee_id"      TEXT         NOT NULL,
  "platform_file_id"  TEXT         NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"        TEXT         NOT NULL,

  CONSTRAINT "guarantee_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "guarantee_attachments_guarantee_id_idx" ON "guarantee_attachments" ("guarantee_id");

ALTER TABLE "guarantee_attachments" ADD CONSTRAINT "guarantee_attachments_guarantee_id_fkey"
  FOREIGN KEY ("guarantee_id") REFERENCES "contract_guarantees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
