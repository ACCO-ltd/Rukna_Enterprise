-- ADR-018 CONST-MATCH-003 — evaluate quantity, price and amount against tolerance independently.
-- The single within_tolerance boolean is retained as the derived overall verdict (CONST-MATCH-004).
-- Existing rows default to true (they were computed under the old single-boolean model).
ALTER TABLE "supplier_bill_match_lines" ADD COLUMN "quantity_within_tolerance" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "supplier_bill_match_lines" ADD COLUMN "price_within_tolerance" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "supplier_bill_match_lines" ADD COLUMN "amount_within_tolerance" BOOLEAN NOT NULL DEFAULT true;
