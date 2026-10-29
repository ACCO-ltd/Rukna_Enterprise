-- AlterTable
ALTER TABLE "posting_policy" ADD COLUMN     "auto_post_tolerated_bills" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bill_approval_above" DECIMAL(18,2),
ADD COLUMN     "invoice_approval_above" DECIMAL(18,2),
ADD COLUMN     "payment_auto_approve_up_to" DECIMAL(18,2) NOT NULL DEFAULT 1000;

