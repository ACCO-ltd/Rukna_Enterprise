-- ADR-021 amendment (2026-09-28): link a programme milestone to the work packages that make up its
-- stage. Readiness to verify is derived on read from the linked packages' verified physical %, so
-- nothing about it is stored here. Removing either side removes the link. Both sides belonging to
-- the same project is enforced in ProgrammeService.

-- CreateTable
CREATE TABLE "programme_milestone_work_packages" (
    "id" TEXT NOT NULL,
    "milestone_id" TEXT NOT NULL,
    "work_package_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programme_milestone_work_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "programme_milestone_work_packages_work_package_id_idx" ON "programme_milestone_work_packages"("work_package_id");

-- CreateIndex
CREATE UNIQUE INDEX "programme_milestone_work_packages_milestone_id_work_package_key" ON "programme_milestone_work_packages"("milestone_id", "work_package_id");

-- AddForeignKey
ALTER TABLE "programme_milestone_work_packages" ADD CONSTRAINT "programme_milestone_work_packages_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "programme_milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_milestone_work_packages" ADD CONSTRAINT "programme_milestone_work_packages_work_package_id_fkey" FOREIGN KEY ("work_package_id") REFERENCES "work_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
