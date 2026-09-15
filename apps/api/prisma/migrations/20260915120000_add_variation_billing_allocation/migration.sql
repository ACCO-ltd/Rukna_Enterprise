-- ADR-030 CONST-COM-027/028 (Commercial redesign, variation billing P1 — ticket C4).
-- The persistence backbone for variation billing: the entitlement/realization split.
--
-- Additive only. Existing tables keep their columns and rows:
--   * VariationOrder gains billing_treatment with DEFAULT 'WITH_STAGE', so every existing row
--     backfills to WITH_STAGE in place (the S-MG-1 backfill — no data migration needed).
--   * variation_billing_allocations is a NEW table. Existing VOs have never been billed via
--     allocations (variationLines is display-only, no VO ClientInvoice exists), so there are NO
--     allocations to backfill: an unrealized VO simply has zero allocation rows and satisfies the
--     invariant trivially (Σ == 0, unrealized). See the C4 report for the code evidence.
--   * ClientInvoice / ContractPaymentInstallment gain only inbound FKs (no column changes).

-- ─── Enums ──────────────────────────────────────────────────────────────────────
CREATE TYPE "VariationBillingTreatment" AS ENUM ('WITH_STAGE', 'STANDALONE');

-- CREDIT_NOTE is declared for Phase 2 and is never written in P1/C5.
CREATE TYPE "VariationAllocationTreatment" AS ENUM ('INVOICE', 'STAGE_REDUCTION', 'CREDIT_NOTE');

-- ─── VariationOrder.billing_treatment (default backfills existing rows) ────────────
ALTER TABLE "variation_orders"
ADD COLUMN "billing_treatment" "VariationBillingTreatment" NOT NULL DEFAULT 'WITH_STAGE';

-- ─── The realization ledger ───────────────────────────────────────────────────────
CREATE TABLE "variation_billing_allocations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "variation_id" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "treatment" "VariationAllocationTreatment" NOT NULL,
    "client_invoice_id" TEXT,
    "installment_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variation_billing_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "variation_billing_allocations_variation_id_idx" ON "variation_billing_allocations"("variation_id");
CREATE INDEX "variation_billing_allocations_organization_id_idx" ON "variation_billing_allocations"("organization_id");
CREATE INDEX "variation_billing_allocations_client_invoice_id_idx" ON "variation_billing_allocations"("client_invoice_id");
CREATE INDEX "variation_billing_allocations_installment_id_idx" ON "variation_billing_allocations"("installment_id");

-- Cascade from the owning VO (the ledger belongs to the variation aggregate); SetNull on the trace
-- links so a cancelled invoice / re-profiled installment never deletes the durable ledger row.
ALTER TABLE "variation_billing_allocations"
ADD CONSTRAINT "variation_billing_allocations_variation_id_fkey"
FOREIGN KEY ("variation_id") REFERENCES "variation_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "variation_billing_allocations"
ADD CONSTRAINT "variation_billing_allocations_client_invoice_id_fkey"
FOREIGN KEY ("client_invoice_id") REFERENCES "client_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "variation_billing_allocations"
ADD CONSTRAINT "variation_billing_allocations_installment_id_fkey"
FOREIGN KEY ("installment_id") REFERENCES "contract_payment_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
