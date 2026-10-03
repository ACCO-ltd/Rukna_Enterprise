-- ADR-043 follow-up (L1): indexes for the project filters on the finance lists and the
-- /finance/projects portfolio. journal_lines.project_id is already indexed.
--
-- Plain CREATE INDEX (not CONCURRENTLY): Prisma runs each migration in a transaction, where
-- CONCURRENTLY is not allowed. These tables are small for ACCO, so the brief write lock is fine;
-- a large tenant would need these created CONCURRENTLY out of band before deploying.

-- GET /invoices?projectId, receipts ?projectId (allocation -> invoice.project_id),
-- portfolio receivables (project_id IN (...)).
CREATE INDEX "client_invoices_project_id_idx" ON "client_invoices"("project_id");

-- GET /bills?projectId, payments ?projectId and the portfolio "bills to pay" read:
-- the header half of the bill-project OR.
CREATE INDEX "supplier_bills_project_id_idx" ON "supplier_bills"("project_id");

-- The line half of the bill-project OR (lines.some.projectId): covering, so the
-- semi-join returns supplier_bill_id from the index alone.
CREATE INDEX "supplier_bill_lines_project_id_supplier_bill_id_idx" ON "supplier_bill_lines"("project_id", "supplier_bill_id");
