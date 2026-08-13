-- Client-first workflow: organization-scoped client codes, richer client profile,
-- and an explicit Project -> Client relationship. Existing project client_name values
-- are preserved for historical compatibility and can be reconciled deliberately.

CREATE TYPE "ClientType" AS ENUM ('COMPANY', 'GOVERNMENT', 'NGO', 'INDIVIDUAL', 'OTHER');

ALTER TABLE "clients"
  ADD COLUMN "type" "ClientType" NOT NULL DEFAULT 'COMPANY',
  ADD COLUMN "address" TEXT,
  ADD COLUMN "notes" TEXT;

CREATE TABLE "client_code_sequences" (
  "organization_id" TEXT NOT NULL,
  "next_value" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_code_sequences_pkey" PRIMARY KEY ("organization_id"),
  CONSTRAINT "client_code_sequences_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "projects"
  ADD COLUMN "client_id" TEXT,
  ADD COLUMN "location" TEXT,
  ADD CONSTRAINT "projects_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "projects_organization_id_client_id_idx" ON "projects"("organization_id", "client_id");
