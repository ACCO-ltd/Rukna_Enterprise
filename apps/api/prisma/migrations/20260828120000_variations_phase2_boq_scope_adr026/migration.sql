-- ADR-026 (Variations Phase 2) — CONST-VAR-007.
-- Scope a client-approved VariationOrder into the BOQ as VARIATION-tagged nodes on a revision.
--
-- Two changes only, both additive — the certify→invoice chain and Contract.contract_value are
-- UNTOUCHED (Option A: identifiability rides the existing BoqNode provenance FK):
--   1. BoqNode.source_change_order_id becomes a REAL FK to variation_orders (was a bare string,
--      seeded Sprint 5 for exactly this). ON DELETE SET NULL preserves baselined-node immutability:
--      a historical node keeps its scope and loses only the link if a VO is ever removed.
--   2. variation_orders gains an apply-to-BOQ marker (boq_applied_at/by/version_id) — the
--      idempotency record for the apply command (a VO applied once cannot apply twice) and the
--      "appliedToBoq" read indicator. Nullable; every existing VO is un-applied.

-- AlterTable — the VO apply-to-BOQ marker.
ALTER TABLE "variation_orders"
    ADD COLUMN "boq_applied_at" TIMESTAMP(3),
    ADD COLUMN "boq_applied_by" TEXT,
    ADD COLUMN "boq_applied_version_id" TEXT;

-- AddForeignKey — BoqNode.source_change_order_id → variation_orders(id). SET NULL, not RESTRICT:
-- a baselined node is immutable and outlives its source; only the provenance link is cleared if a
-- VO is ever removed (which can only happen via a contract cascade delete).
ALTER TABLE "boq_nodes"
    ADD CONSTRAINT "boq_nodes_source_change_order_id_fkey"
    FOREIGN KEY ("source_change_order_id") REFERENCES "variation_orders"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex — resolve "which nodes did this VO introduce" (idempotency guard + P3 read join).
CREATE INDEX "boq_nodes_source_change_order_id_idx" ON "boq_nodes"("source_change_order_id");
