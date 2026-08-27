-- ADR-026 (Variations Phase 1) — CONST-VAR-001/-002/-003/-004/-010.
-- The VariationOrder aggregate (root + signed line items) that changes, but never mutates, the
-- Contract commercial baseline (ADR-017 CONST-COM-001). Contract.contract_value is UNCHANGED here:
-- the governing value is derived, never stored (CONST-VAR-005/006). No downstream table is touched.

-- CreateEnum
CREATE TYPE "VariationOrderStatus" AS ENUM ('DRAFT', 'PENDING_INTERNAL', 'INTERNAL_APPROVED', 'CLIENT_APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "variation_orders" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "reference" VARCHAR(50) NOT NULL,
    "status" "VariationOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "proposed_time_impact_days" INTEGER,
    "created_by" TEXT NOT NULL,
    "submitted_by" TEXT,
    "submitted_at" TIMESTAMP(3),
    "internal_approved_by" TEXT,
    "internal_approved_at" TIMESTAMP(3),
    "client_approved_by" TEXT,
    "client_approved_at" TIMESTAMP(3),
    "client_approval_reference" TEXT,
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "variation_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variation_order_lines" (
    "id" TEXT NOT NULL,
    "variation_order_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_rate" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "variation_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "variation_orders_contract_id_reference_key" ON "variation_orders"("contract_id", "reference");

-- CreateIndex
CREATE INDEX "variation_orders_organization_id_status_idx" ON "variation_orders"("organization_id", "status");

-- CreateIndex
CREATE INDEX "variation_orders_contract_id_status_idx" ON "variation_orders"("contract_id", "status");

-- CreateIndex
CREATE INDEX "variation_order_lines_variation_order_id_idx" ON "variation_order_lines"("variation_order_id");

-- AddForeignKey
ALTER TABLE "variation_orders" ADD CONSTRAINT "variation_orders_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_order_lines" ADD CONSTRAINT "variation_order_lines_variation_order_id_fkey" FOREIGN KEY ("variation_order_id") REFERENCES "variation_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
