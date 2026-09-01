-- CreateEnum
CREATE TYPE "PermissionRiskClass" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RoleAccessReviewDecision" AS ENUM ('CONFIRMED', 'CHANGES_REQUIRED');

-- AlterTable
ALTER TABLE "permissions" ADD COLUMN     "domain" TEXT NOT NULL DEFAULT 'Platform',
ADD COLUMN     "risk_class" "PermissionRiskClass" NOT NULL DEFAULT 'HIGH';

-- CreateTable
CREATE TABLE "role_access_reviews" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "reviewer_user_id" TEXT NOT NULL,
    "decision" "RoleAccessReviewDecision" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_access_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "role_access_reviews_organization_id_role_id_created_at_idx" ON "role_access_reviews"("organization_id", "role_id", "created_at");

-- AddForeignKey
ALTER TABLE "role_access_reviews" ADD CONSTRAINT "role_access_reviews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_access_reviews" ADD CONSTRAINT "role_access_reviews_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
