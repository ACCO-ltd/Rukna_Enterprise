-- ADR-021 CONST-PROG-005 — the time layer of BOQ → WorkPackage → Activity. A ProgrammeActivity
-- carries planned dates / duration / milestone under a work package. No dependency network yet.
CREATE TABLE "programme_activities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "work_package_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "planned_start" DATE,
    "planned_end" DATE,
    "duration_days" INTEGER,
    "is_milestone" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "programme_activities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "programme_activities_work_package_id_code_key" ON "programme_activities"("work_package_id", "code");
CREATE INDEX "programme_activities_work_package_id_idx" ON "programme_activities"("work_package_id");
ALTER TABLE "programme_activities" ADD CONSTRAINT "programme_activities_work_package_id_fkey" FOREIGN KEY ("work_package_id") REFERENCES "work_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
