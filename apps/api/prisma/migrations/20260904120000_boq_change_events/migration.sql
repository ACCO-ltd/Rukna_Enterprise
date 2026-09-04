-- BOQ change history (BOQ refinement Phase 1) — the per-line audit trail behind
-- "who changed what, and what was it before". One immutable row per change, written in the SAME
-- transaction as the node mutation. FK-free on node/version/boq on purpose: an audit fact outlives
-- the node it names (a DELETE event references a node that no longer exists), so these are plain
-- string columns. Additive only.

-- CreateEnum
CREATE TYPE "BoqChangeAction" AS ENUM (
  'CREATE',
  'UPDATE',
  'DELETE',
  'MOVE',
  'IMPORT'
);

-- CreateTable
CREATE TABLE "boq_change_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "boq_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "node_id" TEXT,
    "code" VARCHAR(50),
    "action" "BoqChangeAction" NOT NULL,
    "field" VARCHAR(40),
    "old_value" TEXT,
    "new_value" TEXT,
    "detail" TEXT,
    "actor_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boq_change_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "boq_change_events_version_id_created_at_idx" ON "boq_change_events"("version_id", "created_at");

-- CreateIndex
CREATE INDEX "boq_change_events_version_id_node_id_idx" ON "boq_change_events"("version_id", "node_id");
