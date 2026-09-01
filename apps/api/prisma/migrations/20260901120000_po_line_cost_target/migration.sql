-- PO line cost-target (A3/D7). PurchaseOrderLine gains a direct, per-line project cost
-- attribution so a refined PO (created with zero Material Request) still carries the
-- project + BOQ node a commitment must be attributed to. Both columns are nullable:
-- both set = a project-cost-relevant line (validated: boqNode is a leaf cost node on the
-- project's BOQ); both null = a non-project/org/overhead line. This is the authoritative
-- source captured once at the PO line; GR / PO-backed bill / commitment ledger inherit it.
ALTER TABLE "purchase_order_lines" ADD COLUMN "project_id" TEXT;
ALTER TABLE "purchase_order_lines" ADD COLUMN "boq_node_id" TEXT;

CREATE INDEX "purchase_order_lines_project_id_idx" ON "purchase_order_lines"("project_id");
CREATE INDEX "purchase_order_lines_boq_node_id_idx" ON "purchase_order_lines"("boq_node_id");

ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_boq_node_id_fkey" FOREIGN KEY ("boq_node_id") REFERENCES "boq_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
