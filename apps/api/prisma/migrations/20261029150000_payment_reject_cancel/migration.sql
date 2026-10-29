-- AlterTable
ALTER TABLE "supplier_payments" ADD COLUMN     "cancellation_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by" TEXT,
ADD COLUMN     "rejected_at" TIMESTAMP(3),
ADD COLUMN     "rejected_by" TEXT,
ADD COLUMN     "rejection_reason" TEXT;

