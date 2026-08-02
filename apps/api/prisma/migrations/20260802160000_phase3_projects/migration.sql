-- Phase 3: Project lifecycle, ProjectSuspension, ProjectMember, ProjectMemberRole

CREATE TYPE "ProjectStatus" AS ENUM (
    'DRAFT',
    'APPROVED',
    'MOBILIZING',
    'ACTIVE',
    'PRACTICAL_COMPLETION',
    'CLOSEOUT',
    'CLOSED',
    'CANCELLED'
);

CREATE TYPE "ProjectRole" AS ENUM (
    'PROJECT_MANAGER',
    'QUANTITY_SURVEYOR',
    'SITE_ENGINEER',
    'COMMERCIAL_MANAGER',
    'FINANCE_REVIEWER',
    'VIEWER'
);

-- projects
CREATE TABLE "projects" (
    "id"               TEXT NOT NULL,
    "organization_id"  TEXT NOT NULL,
    "code"             VARCHAR(30) NOT NULL,
    "name"             TEXT NOT NULL,
    "name_ar"          TEXT,
    "description"      TEXT,
    "status"           "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "contract_value"   DECIMAL(18,2),
    "currency"         VARCHAR(3),
    "client_name"      TEXT,
    "start_date"       DATE,
    "expected_end_date" DATE,
    "created_by"       TEXT NOT NULL,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "projects_organization_id_code_key"
    ON "projects"("organization_id", "code");
CREATE INDEX "projects_organization_id_status_idx"
    ON "projects"("organization_id", "status");

ALTER TABLE "projects"
    ADD CONSTRAINT "projects_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- project_suspensions
CREATE TABLE "project_suspensions" (
    "id"           TEXT NOT NULL,
    "project_id"   TEXT NOT NULL,
    "reason"       TEXT NOT NULL,
    "suspended_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspended_by" TEXT NOT NULL,
    "resumed_at"   TIMESTAMP(3),
    "resumed_by"   TEXT,
    CONSTRAINT "project_suspensions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_suspensions_project_id_idx"
    ON "project_suspensions"("project_id");

-- Enforces only one active (non-resumed) suspension per project (ADR-004).
CREATE UNIQUE INDEX "project_suspensions_one_active_per_project"
    ON "project_suspensions"("project_id")
    WHERE "resumed_at" IS NULL;

ALTER TABLE "project_suspensions"
    ADD CONSTRAINT "project_suspensions_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- project_members
CREATE TABLE "project_members" (
    "id"         TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id"    TEXT NOT NULL,
    "joined_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joined_by"  TEXT NOT NULL,
    "removed_at" TIMESTAMP(3),
    "removed_by" TEXT,
    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_members_project_id_user_id_idx"
    ON "project_members"("project_id", "user_id");
CREATE INDEX "project_members_user_id_idx"
    ON "project_members"("user_id");

-- Enforces only one active (non-removed) membership per project+user.
CREATE UNIQUE INDEX "project_members_one_active_per_project_user"
    ON "project_members"("project_id", "user_id")
    WHERE "removed_at" IS NULL;

ALTER TABLE "project_members"
    ADD CONSTRAINT "project_members_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_members"
    ADD CONSTRAINT "project_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- project_member_roles
CREATE TABLE "project_member_roles" (
    "id"          TEXT NOT NULL,
    "member_id"   TEXT NOT NULL,
    "role"        "ProjectRole" NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" TEXT NOT NULL,
    "removed_at"  TIMESTAMP(3),
    CONSTRAINT "project_member_roles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_member_roles_member_id_idx"
    ON "project_member_roles"("member_id");

ALTER TABLE "project_member_roles"
    ADD CONSTRAINT "project_member_roles_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "project_members"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
