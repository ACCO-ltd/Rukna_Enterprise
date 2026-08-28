-- ADR-026 CONST-VAR-011 (Variations Phase 5, Route 7B) — the at-risk commencement authorisation on a
-- VariationOrder. An audited record that ACCO sanctioned starting urgent variation work BEFORE the VO
-- is CLIENT_APPROVED (never an informal verbal instruction, memo Q7B): authorised by the Construction
-- Director + CFO jointly, escalating to the CEO when the recorded exposure exceeds a config-driven cap
-- (OQ-1, provisional USD 25,000). It records who accepted the exposure and how much — and changes
-- NEITHER contracts.contract_value NOR the BOQ. Rows are an immutable history (created, never edited).
--
-- Route 7A adds NO schema: it reuses the existing ADR-019 project-Start condition-override path
-- (projects.actual_start_date + PROJECT_CONDITION_WAIVED audit events), extended in code to permit the
-- two named MANDATORY Start conditions to be waived under apex authority. Nothing to migrate for 7A.

-- CreateTable
CREATE TABLE "variation_order_at_risk_authorisations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "variation_order_id" TEXT NOT NULL,
    "exposure_amount" DECIMAL(18,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "cap_amount" DECIMAL(18,2) NOT NULL,
    "ceo_required" BOOLEAN NOT NULL,
    "construction_director_user_id" TEXT NOT NULL,
    "cfo_user_id" TEXT NOT NULL,
    "ceo_user_id" TEXT,
    "reason" TEXT NOT NULL,
    "vo_status_at_auth" TEXT NOT NULL,
    "authorised_by" TEXT NOT NULL,
    "authorised_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "variation_order_at_risk_authorisations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "variation_order_at_risk_authorisations_organization_id_idx" ON "variation_order_at_risk_authorisations"("organization_id");

-- CreateIndex
CREATE INDEX "variation_order_at_risk_authorisations_variation_order_id_idx" ON "variation_order_at_risk_authorisations"("variation_order_id");

-- AddForeignKey
ALTER TABLE "variation_order_at_risk_authorisations" ADD CONSTRAINT "variation_order_at_risk_authorisations_variation_order_id_fkey" FOREIGN KEY ("variation_order_id") REFERENCES "variation_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
