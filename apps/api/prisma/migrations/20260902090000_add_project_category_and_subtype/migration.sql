-- Project type (PTD1-PTD5). A classification/reporting attribute only: it drives no workflow,
-- template or approval, and is NOT part of the project code (ADR-025 unchanged).
--
-- Additive and legacy-safe. `ProjectCategory` is a fixed 6-value enum. `project_subtypes` is the
-- admin-configurable, org-scoped subtype registry (mirrors `districts`), one row per
-- (organization, category, name), (de)activatable via `MasterDataStatus`. Projects gain a nullable
-- `category` (required in the create DTO, mirroring `district_id`) and an optional `subtype_id` FK.
-- Both columns are nullable so legacy rows stay "Untyped" with no backfill.

-- CreateEnum
CREATE TYPE "ProjectCategory" AS ENUM (
  'COMMERCIAL',
  'RESIDENTIAL',
  'INFRASTRUCTURE_CIVIL',
  'INSTITUTIONAL_PUBLIC',
  'INDUSTRIAL',
  'RENOVATION_FITOUT'
);

-- CreateTable
CREATE TABLE "project_subtypes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "category" "ProjectCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "MasterDataStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_subtypes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_subtypes_organization_id_category_status_idx" ON "project_subtypes"("organization_id", "category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_subtypes_organization_id_category_name_key" ON "project_subtypes"("organization_id", "category", "name");

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "category" "ProjectCategory";
ALTER TABLE "projects" ADD COLUMN     "subtype_id" TEXT;

-- CreateIndex
CREATE INDEX "projects_organization_id_subtype_id_idx" ON "projects"("organization_id", "subtype_id");

-- AddForeignKey
ALTER TABLE "project_subtypes" ADD CONSTRAINT "project_subtypes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_subtype_id_fkey" FOREIGN KEY ("subtype_id") REFERENCES "project_subtypes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
