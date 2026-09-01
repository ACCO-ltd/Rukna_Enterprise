-- CreateEnum
CREATE TYPE "RoleKind" AS ENUM ('SYSTEM', 'CUSTOM');

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "kind" "RoleKind" NOT NULL DEFAULT 'CUSTOM',
ADD COLUMN     "owner_user_id" TEXT,
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "template_role_id" TEXT;

-- The seeded platform administrator is a protected baseline rather than a custom role.
UPDATE "roles" SET "kind" = 'SYSTEM' WHERE "name" = 'ADMIN';

-- CreateIndex
CREATE INDEX "roles_owner_user_id_idx" ON "roles"("owner_user_id");

-- CreateIndex
CREATE INDEX "roles_template_role_id_idx" ON "roles"("template_role_id");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_template_role_id_fkey" FOREIGN KEY ("template_role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
