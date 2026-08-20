-- CONST-PROG-012: a BOQ leaf belongs to at most one work package, so its verified progress is
-- counted exactly once in the weighted roll-up. Replaces the (work_package_id, boq_node_id)
-- uniqueness (which allowed a leaf in several packages) with uniqueness on boq_node_id alone.

-- DropIndex
DROP INDEX "work_package_boq_nodes_boq_node_id_idx";

-- DropIndex
DROP INDEX "work_package_boq_nodes_work_package_id_boq_node_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "work_package_boq_nodes_boq_node_id_key" ON "work_package_boq_nodes"("boq_node_id");
