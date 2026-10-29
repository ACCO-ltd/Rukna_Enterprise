-- AlterTable
ALTER TABLE "payment_receipts" ADD COLUMN     "reversal_journal_entry_id" TEXT,
ADD COLUMN     "reversal_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMP(3),
ADD COLUMN     "reversed_by" TEXT;

