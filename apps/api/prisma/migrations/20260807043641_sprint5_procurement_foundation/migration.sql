-- CreateEnum
CREATE TYPE "BoqSourceType" AS ENUM ('BASELINE', 'VARIATION');

-- CreateEnum
CREATE TYPE "ProcurementLineType" AS ENUM ('MATERIAL', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "MaterialRequestScope" AS ENUM ('PROJECT', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "MaterialRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_ORDERED', 'FULLY_ORDERED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderRevisionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GrnStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'POSTED', 'EXCEPTION_PENDING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QualityStatus" AS ENUM ('PENDING_INSPECTION', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BillMatchType" AS ENUM ('TWO_WAY', 'THREE_WAY');

-- CreateEnum
CREATE TYPE "BillMatchStatus" AS ENUM ('NOT_RUN', 'MATCHED', 'MATCHED_WITH_TOLERANCE', 'EXCEPTION', 'APPROVED_EXCEPTION');

-- CreateEnum
CREATE TYPE "CommitmentStage" AS ENUM ('COMMITTED', 'ACCRUED', 'ACTUAL');

-- CreateEnum
CREATE TYPE "CommitmentSourceDocType" AS ENUM ('PURCHASE_ORDER_REVISION', 'GOODS_RECEIPT', 'SUPPLIER_BILL', 'PO_CANCELLATION', 'GRN_REVERSAL', 'BILL_REVERSAL', 'OVER_RECEIPT_ADJUSTMENT', 'EXCEPTION_APPROVAL');

-- CreateEnum
CREATE TYPE "ToleranceScopeType" AS ENUM ('ORGANIZATION', 'SPEND_CATEGORY', 'SUPPLIER', 'PURCHASE_ORDER');

-- CreateEnum
CREATE TYPE "MaterialStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "MasterDataStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PolicyConditionField" AS ENUM ('DOCUMENT_AMOUNT', 'PROJECT_ID', 'DEPARTMENT_ID', 'SPEND_CATEGORY', 'CURRENCY');

-- CreateEnum
CREATE TYPE "PolicyConditionOperator" AS ENUM ('EQ', 'NE', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN', 'IN');

-- AlterTable
ALTER TABLE "approval_instances" ADD COLUMN     "condition_snapshot" JSONB,
ADD COLUMN     "evaluated_amount" DECIMAL(18,2),
ADD COLUMN     "matched_policy_id" TEXT,
ADD COLUMN     "matched_policy_version" INTEGER,
ADD COLUMN     "reporting_currency_code" VARCHAR(3);

-- AlterTable
ALTER TABLE "boq_nodes" ADD COLUMN     "source_change_order_id" TEXT,
ADD COLUMN     "source_type" "BoqSourceType" NOT NULL DEFAULT 'BASELINE';

-- AlterTable
ALTER TABLE "supplier_bill_lines" ADD COLUMN     "line_type" "ProcurementLineType" NOT NULL DEFAULT 'SERVICE',
ADD COLUMN     "material_id" TEXT,
ADD COLUMN     "spend_category_id" TEXT,
ADD COLUMN     "unit_of_measure_id" TEXT;

-- AlterTable
ALTER TABLE "supplier_bills" ADD COLUMN     "match_status" "BillMatchStatus" NOT NULL DEFAULT 'NOT_RUN',
ADD COLUMN     "purchase_order_revision_id" TEXT;

-- AlterTable
ALTER TABLE "workflow_requirement_policies" ADD COLUMN     "condition_field" "PolicyConditionField",
ADD COLUMN     "condition_op" "PolicyConditionOperator",
ADD COLUMN     "condition_value" TEXT,
ADD COLUMN     "condition_value2" TEXT,
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "symbol" VARCHAR(10) NOT NULL,
    "status" "MasterDataStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_categories" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "parent_id" TEXT,
    "status" "MasterDataStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spend_categories" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "parent_id" TEXT,
    "status" "MasterDataStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spend_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "description" TEXT,
    "material_category_id" TEXT NOT NULL,
    "default_spend_category_id" TEXT,
    "base_unit_of_measure_id" TEXT NOT NULL,
    "status" "MaterialStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "mr_number" VARCHAR(30) NOT NULL,
    "request_scope" "MaterialRequestScope" NOT NULL,
    "project_id" TEXT,
    "requested_by" TEXT NOT NULL,
    "requested_date" DATE NOT NULL,
    "required_by_date" DATE,
    "description" TEXT,
    "status" "MaterialRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "approval_instance_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_request_lines" (
    "id" TEXT NOT NULL,
    "material_request_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "line_type" "ProcurementLineType" NOT NULL,
    "material_id" TEXT,
    "description" TEXT NOT NULL,
    "unit_of_measure_id" TEXT NOT NULL,
    "requested_quantity" DECIMAL(18,4) NOT NULL,
    "approved_quantity" DECIMAL(18,4),
    "boq_node_id" TEXT,
    "spend_category_id" TEXT,
    "department_id" TEXT,
    "cost_center_id" TEXT,
    "project_cost_category_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "po_number" VARCHAR(30) NOT NULL,
    "current_revision_id" TEXT,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'OPEN',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_revisions" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "status" "PurchaseOrderRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "currency_code" VARCHAR(3) NOT NULL,
    "effective_from" DATE NOT NULL,
    "reason" TEXT,
    "delivery_address" TEXT,
    "expected_delivery_date" DATE,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "approval_instance_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "purchase_order_revision_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "line_type" "ProcurementLineType" NOT NULL,
    "material_id" TEXT,
    "description" TEXT NOT NULL,
    "unit_of_measure_id" TEXT NOT NULL,
    "ordered_quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "extended_amount" DECIMAL(18,2) NOT NULL,
    "spend_category_id" TEXT,
    "tax_code_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_line_request_allocations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "purchase_order_line_id" TEXT NOT NULL,
    "material_request_line_id" TEXT NOT NULL,
    "allocated_quantity" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_line_request_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_notes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "grn_number" VARCHAR(30) NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "purchase_order_revision_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "delivery_date" DATE NOT NULL,
    "delivery_note_ref" TEXT,
    "status" "GrnStatus" NOT NULL DEFAULT 'DRAFT',
    "exception_reason" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipt_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" TEXT NOT NULL,
    "goods_receipt_note_id" TEXT NOT NULL,
    "purchase_order_line_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "line_type" "ProcurementLineType" NOT NULL,
    "material_id" TEXT,
    "unit_of_measure_id" TEXT NOT NULL,
    "spend_category_id" TEXT,
    "ordered_quantity" DECIMAL(18,4) NOT NULL,
    "previously_received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "received_quantity" DECIMAL(18,4) NOT NULL,
    "accepted_quantity" DECIMAL(18,4) NOT NULL,
    "rejected_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejection_reason" TEXT,
    "quality_status" "QualityStatus" NOT NULL DEFAULT 'PENDING_INSPECTION',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_line_allocations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "goods_receipt_line_id" TEXT NOT NULL,
    "po_line_request_allocation_id" TEXT NOT NULL,
    "received_quantity" DECIMAL(18,4) NOT NULL,
    "accepted_quantity" DECIMAL(18,4) NOT NULL,
    "rejected_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipt_line_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_bill_matches" (
    "id" TEXT NOT NULL,
    "supplier_bill_id" TEXT NOT NULL,
    "match_type" "BillMatchType" NOT NULL,
    "status" "BillMatchStatus" NOT NULL DEFAULT 'NOT_RUN',
    "matched_at" TIMESTAMP(3),
    "matched_by" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "approval_reason" TEXT,
    "approval_instance_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_bill_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_bill_match_lines" (
    "id" TEXT NOT NULL,
    "supplier_bill_match_id" TEXT NOT NULL,
    "supplier_bill_line_id" TEXT NOT NULL,
    "purchase_order_line_id" TEXT NOT NULL,
    "goods_receipt_line_id" TEXT,
    "po_quantity" DECIMAL(18,4) NOT NULL,
    "received_quantity" DECIMAL(18,4),
    "billed_quantity" DECIMAL(18,4) NOT NULL,
    "po_unit_price" DECIMAL(18,4) NOT NULL,
    "billed_unit_price" DECIMAL(18,4) NOT NULL,
    "quantity_variance" DECIMAL(18,4) NOT NULL,
    "price_variance" DECIMAL(18,4) NOT NULL,
    "amount_variance" DECIMAL(18,2) NOT NULL,
    "within_tolerance" BOOLEAN NOT NULL,
    "exception_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_bill_match_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matching_tolerance_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "scope_type" "ToleranceScopeType" NOT NULL,
    "purchase_order_id" TEXT,
    "supplier_id" TEXT,
    "spend_category_id" TEXT,
    "price_variance_percent" DECIMAL(6,3),
    "price_variance_absolute" DECIMAL(18,2),
    "quantity_variance_percent" DECIMAL(6,3),
    "quantity_variance_absolute" DECIMAL(18,4),
    "amount_variance_absolute" DECIMAL(18,2),
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" "MasterDataStatus" NOT NULL DEFAULT 'ACTIVE',
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matching_tolerance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "over_receipt_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "scope_type" "ToleranceScopeType" NOT NULL,
    "purchase_order_id" TEXT,
    "spend_category_id" TEXT,
    "over_receipt_percent" DECIMAL(6,3) NOT NULL,
    "status" "MasterDataStatus" NOT NULL DEFAULT 'ACTIVE',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "over_receipt_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commitment_ledger_entries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "boq_node_id" TEXT,
    "department_id" TEXT,
    "cost_center_id" TEXT,
    "material_id" TEXT,
    "supplier_id" TEXT,
    "purchase_order_id" TEXT,
    "spend_category_id" TEXT,
    "stage" "CommitmentStage" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL,
    "reporting_amount" DECIMAL(18,2) NOT NULL,
    "exchange_rate_snapshot" DECIMAL(18,6) NOT NULL,
    "source_document_type" "CommitmentSourceDocType" NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "source_line_id" TEXT,
    "source_revision" INTEGER,
    "event_type" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "accounting_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commitment_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "units_of_measure_organization_id_status_idx" ON "units_of_measure"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_organization_id_code_key" ON "units_of_measure"("organization_id", "code");

-- CreateIndex
CREATE INDEX "material_categories_organization_id_status_idx" ON "material_categories"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "material_categories_organization_id_code_key" ON "material_categories"("organization_id", "code");

-- CreateIndex
CREATE INDEX "spend_categories_organization_id_status_idx" ON "spend_categories"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "spend_categories_organization_id_code_key" ON "spend_categories"("organization_id", "code");

-- CreateIndex
CREATE INDEX "materials_organization_id_status_idx" ON "materials"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "materials_organization_id_code_key" ON "materials"("organization_id", "code");

-- CreateIndex
CREATE INDEX "material_requests_organization_id_status_idx" ON "material_requests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "material_requests_organization_id_project_id_idx" ON "material_requests"("organization_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "material_requests_organization_id_mr_number_key" ON "material_requests"("organization_id", "mr_number");

-- CreateIndex
CREATE INDEX "material_request_lines_material_request_id_idx" ON "material_request_lines"("material_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "material_request_lines_material_request_id_line_number_key" ON "material_request_lines"("material_request_id", "line_number");

-- CreateIndex
CREATE INDEX "purchase_orders_organization_id_status_idx" ON "purchase_orders"("organization_id", "status");

-- CreateIndex
CREATE INDEX "purchase_orders_organization_id_supplier_id_idx" ON "purchase_orders"("organization_id", "supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_organization_id_po_number_key" ON "purchase_orders"("organization_id", "po_number");

-- CreateIndex
CREATE INDEX "purchase_order_revisions_purchase_order_id_status_idx" ON "purchase_order_revisions"("purchase_order_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_revisions_purchase_order_id_revision_number_key" ON "purchase_order_revisions"("purchase_order_id", "revision_number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchase_order_revision_id_idx" ON "purchase_order_lines"("purchase_order_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_revision_id_line_number_key" ON "purchase_order_lines"("purchase_order_revision_id", "line_number");

-- CreateIndex
CREATE INDEX "purchase_order_line_request_allocations_purchase_order_line_idx" ON "purchase_order_line_request_allocations"("purchase_order_line_id");

-- CreateIndex
CREATE INDEX "purchase_order_line_request_allocations_material_request_li_idx" ON "purchase_order_line_request_allocations"("material_request_line_id");

-- CreateIndex
CREATE INDEX "goods_receipt_notes_organization_id_status_idx" ON "goods_receipt_notes"("organization_id", "status");

-- CreateIndex
CREATE INDEX "goods_receipt_notes_purchase_order_id_idx" ON "goods_receipt_notes"("purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_notes_organization_id_grn_number_key" ON "goods_receipt_notes"("organization_id", "grn_number");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_goods_receipt_note_id_idx" ON "goods_receipt_lines"("goods_receipt_note_id");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_purchase_order_line_id_idx" ON "goods_receipt_lines"("purchase_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_lines_goods_receipt_note_id_line_number_key" ON "goods_receipt_lines"("goods_receipt_note_id", "line_number");

-- CreateIndex
CREATE INDEX "goods_receipt_line_allocations_goods_receipt_line_id_idx" ON "goods_receipt_line_allocations"("goods_receipt_line_id");

-- CreateIndex
CREATE INDEX "goods_receipt_line_allocations_po_line_request_allocation_i_idx" ON "goods_receipt_line_allocations"("po_line_request_allocation_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bill_matches_supplier_bill_id_key" ON "supplier_bill_matches"("supplier_bill_id");

-- CreateIndex
CREATE INDEX "supplier_bill_match_lines_supplier_bill_match_id_idx" ON "supplier_bill_match_lines"("supplier_bill_match_id");

-- CreateIndex
CREATE INDEX "matching_tolerance_policies_organization_id_scope_type_stat_idx" ON "matching_tolerance_policies"("organization_id", "scope_type", "status");

-- CreateIndex
CREATE INDEX "over_receipt_policies_organization_id_scope_type_status_idx" ON "over_receipt_policies"("organization_id", "scope_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commitment_ledger_entries_idempotency_key_key" ON "commitment_ledger_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "commitment_ledger_entries_organization_id_project_id_stage_idx" ON "commitment_ledger_entries"("organization_id", "project_id", "stage");

-- CreateIndex
CREATE INDEX "commitment_ledger_entries_organization_id_boq_node_id_stage_idx" ON "commitment_ledger_entries"("organization_id", "boq_node_id", "stage");

-- CreateIndex
CREATE INDEX "commitment_ledger_entries_source_document_id_source_documen_idx" ON "commitment_ledger_entries"("source_document_id", "source_document_type");

-- AddForeignKey
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units_of_measure" ADD CONSTRAINT "units_of_measure_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_categories" ADD CONSTRAINT "material_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_categories" ADD CONSTRAINT "material_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "material_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_categories" ADD CONSTRAINT "spend_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spend_categories" ADD CONSTRAINT "spend_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "spend_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_material_category_id_fkey" FOREIGN KEY ("material_category_id") REFERENCES "material_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_default_spend_category_id_fkey" FOREIGN KEY ("default_spend_category_id") REFERENCES "spend_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_base_unit_of_measure_id_fkey" FOREIGN KEY ("base_unit_of_measure_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_material_request_id_fkey" FOREIGN KEY ("material_request_id") REFERENCES "material_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_unit_of_measure_id_fkey" FOREIGN KEY ("unit_of_measure_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_request_lines" ADD CONSTRAINT "material_request_lines_spend_category_id_fkey" FOREIGN KEY ("spend_category_id") REFERENCES "spend_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_revisions" ADD CONSTRAINT "purchase_order_revisions_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_revision_id_fkey" FOREIGN KEY ("purchase_order_revision_id") REFERENCES "purchase_order_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_unit_of_measure_id_fkey" FOREIGN KEY ("unit_of_measure_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_spend_category_id_fkey" FOREIGN KEY ("spend_category_id") REFERENCES "spend_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_line_request_allocations" ADD CONSTRAINT "purchase_order_line_request_allocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_line_request_allocations" ADD CONSTRAINT "purchase_order_line_request_allocations_purchase_order_lin_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_line_request_allocations" ADD CONSTRAINT "purchase_order_line_request_allocations_material_request_l_fkey" FOREIGN KEY ("material_request_line_id") REFERENCES "material_request_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_purchase_order_revision_id_fkey" FOREIGN KEY ("purchase_order_revision_id") REFERENCES "purchase_order_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_notes" ADD CONSTRAINT "goods_receipt_notes_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goods_receipt_note_id_fkey" FOREIGN KEY ("goods_receipt_note_id") REFERENCES "goods_receipt_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_unit_of_measure_id_fkey" FOREIGN KEY ("unit_of_measure_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_spend_category_id_fkey" FOREIGN KEY ("spend_category_id") REFERENCES "spend_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_line_allocations" ADD CONSTRAINT "goods_receipt_line_allocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_line_allocations" ADD CONSTRAINT "goods_receipt_line_allocations_goods_receipt_line_id_fkey" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "goods_receipt_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_line_allocations" ADD CONSTRAINT "goods_receipt_line_allocations_po_line_request_allocation__fkey" FOREIGN KEY ("po_line_request_allocation_id") REFERENCES "purchase_order_line_request_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bill_match_lines" ADD CONSTRAINT "supplier_bill_match_lines_supplier_bill_match_id_fkey" FOREIGN KEY ("supplier_bill_match_id") REFERENCES "supplier_bill_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bill_match_lines" ADD CONSTRAINT "supplier_bill_match_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching_tolerance_policies" ADD CONSTRAINT "matching_tolerance_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching_tolerance_policies" ADD CONSTRAINT "matching_tolerance_policies_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching_tolerance_policies" ADD CONSTRAINT "matching_tolerance_policies_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matching_tolerance_policies" ADD CONSTRAINT "matching_tolerance_policies_spend_category_id_fkey" FOREIGN KEY ("spend_category_id") REFERENCES "spend_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "over_receipt_policies" ADD CONSTRAINT "over_receipt_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "over_receipt_policies" ADD CONSTRAINT "over_receipt_policies_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "over_receipt_policies" ADD CONSTRAINT "over_receipt_policies_spend_category_id_fkey" FOREIGN KEY ("spend_category_id") REFERENCES "spend_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitment_ledger_entries" ADD CONSTRAINT "commitment_ledger_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitment_ledger_entries" ADD CONSTRAINT "commitment_ledger_entries_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitment_ledger_entries" ADD CONSTRAINT "commitment_ledger_entries_spend_category_id_fkey" FOREIGN KEY ("spend_category_id") REFERENCES "spend_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitment_ledger_entries" ADD CONSTRAINT "commitment_ledger_entries_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
