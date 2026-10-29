-- ADR-046 §5 — IPC invoices bill the period, not the cumulative certificate, and net retention and
-- advance recovery. Additive only: existing invoices keep certified_gross_amount = NULL and zero
-- deductions, which is exactly how they were raised (gross, no netting).
-- AlterEnum
ALTER TYPE "AccountSubtype" ADD VALUE 'RETENTION_RECEIVABLE';

-- AlterTable
ALTER TABLE "client_invoices" ADD COLUMN     "advance_recovery_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "certified_gross_amount" DECIMAL(18,2),
ADD COLUMN     "other_deductions_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "retention_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;
