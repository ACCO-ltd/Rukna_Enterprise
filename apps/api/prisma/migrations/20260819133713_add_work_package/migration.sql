-- CreateTable
CREATE TABLE "work_packages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "responsible_owner" TEXT,
    "progress_weight" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_package_boq_nodes" (
    "id" TEXT NOT NULL,
    "work_package_id" TEXT NOT NULL,
    "boq_node_id" TEXT NOT NULL,

    CONSTRAINT "work_package_boq_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_packages_project_id_idx" ON "work_packages"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_packages_project_id_code_key" ON "work_packages"("project_id", "code");

-- CreateIndex
CREATE INDEX "work_package_boq_nodes_work_package_id_idx" ON "work_package_boq_nodes"("work_package_id");

-- CreateIndex
CREATE INDEX "work_package_boq_nodes_boq_node_id_idx" ON "work_package_boq_nodes"("boq_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_package_boq_nodes_work_package_id_boq_node_id_key" ON "work_package_boq_nodes"("work_package_id", "boq_node_id");

-- AddForeignKey
ALTER TABLE "work_packages" ADD CONSTRAINT "work_packages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_package_boq_nodes" ADD CONSTRAINT "work_package_boq_nodes_work_package_id_fkey" FOREIGN KEY ("work_package_id") REFERENCES "work_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_package_boq_nodes" ADD CONSTRAINT "work_package_boq_nodes_boq_node_id_fkey" FOREIGN KEY ("boq_node_id") REFERENCES "boq_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

