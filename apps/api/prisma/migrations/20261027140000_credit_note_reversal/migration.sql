-- Phase 0 H2 — credit note reversal (EVT-AR-008).
-- AlterTable
ALTER TABLE "credit_notes" ADD COLUMN     "reversal_journal_entry_id" TEXT,
ADD COLUMN     "reversal_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMP(3),
ADD COLUMN     "reversed_by" TEXT;

