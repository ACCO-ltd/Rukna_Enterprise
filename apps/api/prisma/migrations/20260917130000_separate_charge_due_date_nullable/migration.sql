-- Slice 2 convergence: DRAFT separate-charge invoices have no due date until finance sets payment
-- terms during invoice preparation. Posted invoices (IPC / installment / VO) carry a due date set
-- at generation time; this column remains non-null for them in practice.
ALTER TABLE "client_invoices" ALTER COLUMN "due_date" DROP NOT NULL;
