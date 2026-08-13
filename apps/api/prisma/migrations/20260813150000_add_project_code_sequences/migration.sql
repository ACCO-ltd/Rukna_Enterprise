CREATE TABLE "project_code_sequences" (
    "organization_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_code_sequences_pkey" PRIMARY KEY ("organization_id", "year")
);

ALTER TABLE "project_code_sequences"
ADD CONSTRAINT "project_code_sequences_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
