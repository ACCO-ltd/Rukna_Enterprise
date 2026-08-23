-- ADR-020 CONST-BOQ-020/021 — org-level catalogue of reusable BOQ work items (scope), distinct from
-- the procurement Material catalogue. Holds no authoritative rate — only a last-used rate as
-- assistance. Grows just-in-time as work is entered.
CREATE TABLE "boq_item_library" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "default_unit" VARCHAR(20),
    "measurement_method" "MeasurementMethod" NOT NULL DEFAULT 'QUANTITY',
    "pricing_basis" "PricingBasis" NOT NULL DEFAULT 'UNIT_RATE',
    "category" TEXT,
    "last_used_rate" DECIMAL(18,2),
    "last_used_at" TIMESTAMP(3),
    "last_used_project_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "boq_item_library_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "boq_item_library_organization_id_code_key" ON "boq_item_library"("organization_id", "code");
CREATE INDEX "boq_item_library_organization_id_active_idx" ON "boq_item_library"("organization_id", "active");
