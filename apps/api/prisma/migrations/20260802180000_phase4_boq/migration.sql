-- Phase 4: BOQ versioning tree (Boq, BoqVersion, BoqNode)

CREATE TYPE "BoqVersionStatus" AS ENUM ('DRAFT', 'BASELINED', 'SUPERSEDED', 'CANCELLED');

-- boqs (one BOQ per project)
CREATE TABLE "boqs" (
    "id"                           TEXT NOT NULL,
    "project_id"                   TEXT NOT NULL,
    "organization_id"              TEXT NOT NULL,
    "original_baseline_version_id" TEXT,
    "current_approved_version_id"  TEXT,
    "current_draft_version_id"     TEXT,
    "created_at"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "boqs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "boqs_project_id_key" ON "boqs"("project_id");
CREATE INDEX "boqs_organization_id_idx" ON "boqs"("organization_id");

ALTER TABLE "boqs"
    ADD CONSTRAINT "boqs_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- boq_versions
CREATE TABLE "boq_versions" (
    "id"             TEXT NOT NULL,
    "boq_id"         TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status"         "BoqVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "notes"          TEXT,
    "baselined_at"   TIMESTAMP(3),
    "baselined_by"   TEXT,
    "created_by"     TEXT NOT NULL,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "boq_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "boq_versions_boq_id_version_number_key" ON "boq_versions"("boq_id", "version_number");
CREATE INDEX "boq_versions_boq_id_status_idx" ON "boq_versions"("boq_id", "status");

ALTER TABLE "boq_versions"
    ADD CONSTRAINT "boq_versions_boq_id_fkey"
    FOREIGN KEY ("boq_id") REFERENCES "boqs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Soft FK pointers on boqs (nullable — not enforced as hard FKs to avoid circular dep).
-- Application layer is responsible for maintaining consistency.
-- ALTER TABLE "boqs" ADD CONSTRAINT "boqs_original_baseline_version_id_fkey" ...
-- Omitted intentionally: these point back to boq_versions which depends on boqs.

-- boq_nodes
CREATE TABLE "boq_nodes" (
    "id"             TEXT NOT NULL,
    "boq_id"         TEXT NOT NULL,
    "version_id"     TEXT NOT NULL,
    "parent_id"      TEXT,
    "path"           TEXT NOT NULL,
    "depth"          INTEGER NOT NULL DEFAULT 0,
    "sort_order"     INTEGER NOT NULL DEFAULT 0,
    "code"           VARCHAR(50) NOT NULL,
    "description"    TEXT NOT NULL,
    "description_ar" TEXT,
    "unit"           VARCHAR(20),
    "quantity"       DECIMAL(18,3),
    "unit_rate"      DECIMAL(18,2),
    "currency"       VARCHAR(3),
    "total_amount"   DECIMAL(18,2),
    "is_leaf"        BOOLEAN NOT NULL DEFAULT false,
    "origin_node_id" TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "boq_nodes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "boq_nodes_version_id_parent_id_idx" ON "boq_nodes"("version_id", "parent_id");
CREATE INDEX "boq_nodes_version_id_path_idx" ON "boq_nodes"("version_id", "path");

ALTER TABLE "boq_nodes"
    ADD CONSTRAINT "boq_nodes_boq_id_fkey"
    FOREIGN KEY ("boq_id") REFERENCES "boqs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "boq_nodes"
    ADD CONSTRAINT "boq_nodes_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "boq_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "boq_nodes"
    ADD CONSTRAINT "boq_nodes_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "boq_nodes"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
