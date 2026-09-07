-- Project-level (non-BOQ) cost coding on the general ledger.
--
-- A purchase-order line may target a project with a spend category and no BOQ node —
-- site security, transport, insurance, temporary facilities: real project cost that a
-- contractual bill of quantities has no line for. The commitment ledger has always
-- carried that category; journal_lines did not, so the attribution was lost the moment
-- the cost was posted and project-level cost reached the accounts unclassified.
--
-- Nullable with no backfill: historical journal lines genuinely have no category, and
-- inventing one would be worse than leaving it absent.
ALTER TABLE "journal_lines" ADD COLUMN "spend_category_id" TEXT;

CREATE INDEX "journal_lines_spend_category_id_idx" ON "journal_lines"("spend_category_id");
