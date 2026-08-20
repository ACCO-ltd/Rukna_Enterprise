-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "short_code" VARCHAR(8);

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "district_id" TEXT;

-- CreateTable
CREATE TABLE "districts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" VARCHAR(8) NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "districts_organization_id_active_idx" ON "districts"("organization_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "districts_organization_id_code_key" ON "districts"("organization_id", "code");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "districts" ADD CONSTRAINT "districts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

