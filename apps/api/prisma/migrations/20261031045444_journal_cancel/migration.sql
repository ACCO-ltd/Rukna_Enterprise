-- AlterEnum
ALTER TYPE "JournalStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "cancellation_reason" VARCHAR(500),
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by" TEXT;
