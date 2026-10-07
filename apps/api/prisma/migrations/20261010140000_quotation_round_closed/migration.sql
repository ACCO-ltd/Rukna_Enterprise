-- ADR-044 review M1 — a quotation round is closed once the purchase order raised from its award is
-- confirmed. Any quantity that order left out may only be ordered through a NEW round, so the
-- one-live-round-per-MR index now ignores closed rounds as well as cancelled ones.

-- AlterTable
ALTER TABLE "quotation_requests" ADD COLUMN "closed_at" TIMESTAMP(3);

-- Recreate the partial unique index with the closed-round exclusion.
DROP INDEX "quotation_requests_one_live_per_mr";
CREATE UNIQUE INDEX "quotation_requests_one_live_per_mr"
  ON "quotation_requests" ("organization_id", "material_request_id")
  WHERE "status" <> 'CANCELLED' AND "closed_at" IS NULL;
