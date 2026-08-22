-- DropForeignKey
ALTER TABLE "receipt_allocations" DROP CONSTRAINT "receipt_allocations_certificate_id_fkey";

-- DropForeignKey
ALTER TABLE "receipt_allocations" DROP CONSTRAINT "receipt_allocations_receipt_id_fkey";

-- DropTable
DROP TABLE "receipt_allocations";

