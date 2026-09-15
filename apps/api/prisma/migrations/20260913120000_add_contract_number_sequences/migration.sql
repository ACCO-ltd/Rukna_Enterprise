-- ADR-030 CONST-COM-022 — per-project contract-number sequence (`{project.code}-C{n}`).
-- Additive: new table only. No change to existing tables or contract numbers. Mirrors
-- project_code_sequences (atomic upsert-increment). Keyed by project so the counter is stable
-- across the project's lifetime (CLOSED/CANCELLED predecessors do not reset it).
CREATE TABLE "contract_number_sequences" (
    "project_id" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_number_sequences_pkey" PRIMARY KEY ("project_id")
);

ALTER TABLE "contract_number_sequences"
ADD CONSTRAINT "contract_number_sequences_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
