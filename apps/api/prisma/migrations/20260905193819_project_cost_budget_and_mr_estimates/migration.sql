-- CreateEnum
CREATE TYPE "ProjectCostBudgetStatus" AS ENUM ('DRAFT', 'BASELINED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "MaterialRequestPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- AlterTable
ALTER TABLE "material_request_lines" ADD COLUMN     "estimated_unit_price" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "material_requests" ADD COLUMN     "priority" "MaterialRequestPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "title" VARCHAR(160);

-- CreateTable
CREATE TABLE "project_cost_budgets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "ProjectCostBudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(3) NOT NULL,
    "notes" TEXT,
    "derived_from_id" TEXT,
    "prepared_by" TEXT NOT NULL,
    "baselined_at" TIMESTAMP(3),
    "baselined_by" TEXT,
    "superseded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_cost_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_cost_budget_lines" (
    "id" TEXT NOT NULL,
    "budget_id" TEXT NOT NULL,
    "boq_node_id" TEXT,
    "spend_category_id" TEXT,
    "description" TEXT NOT NULL,
    "budget_amount" DECIMAL(18,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_cost_budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_cost_budgets_organization_id_project_id_status_idx" ON "project_cost_budgets"("organization_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_cost_budgets_project_id_version_number_key" ON "project_cost_budgets"("project_id", "version_number");

-- CreateIndex
CREATE INDEX "project_cost_budget_lines_budget_id_idx" ON "project_cost_budget_lines"("budget_id");

-- CreateIndex
CREATE INDEX "project_cost_budget_lines_boq_node_id_idx" ON "project_cost_budget_lines"("boq_node_id");

-- AddForeignKey
ALTER TABLE "project_cost_budgets" ADD CONSTRAINT "project_cost_budgets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_budgets" ADD CONSTRAINT "project_cost_budgets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_budgets" ADD CONSTRAINT "project_cost_budgets_derived_from_id_fkey" FOREIGN KEY ("derived_from_id") REFERENCES "project_cost_budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_budget_lines" ADD CONSTRAINT "project_cost_budget_lines_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "project_cost_budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_budget_lines" ADD CONSTRAINT "project_cost_budget_lines_boq_node_id_fkey" FOREIGN KEY ("boq_node_id") REFERENCES "boq_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_budget_lines" ADD CONSTRAINT "project_cost_budget_lines_spend_category_id_fkey" FOREIGN KEY ("spend_category_id") REFERENCES "spend_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
