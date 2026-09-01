-- DropIndex
DROP INDEX "boq_nodes_source_change_order_id_idx";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "temporary_password_expires_at" TIMESTAMP(3),
ADD COLUMN     "session_version" INTEGER NOT NULL DEFAULT 0;
