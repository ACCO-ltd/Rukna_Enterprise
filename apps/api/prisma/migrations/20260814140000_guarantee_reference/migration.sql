-- ADR-017 — a guarantee carries its own instrument reference.
--
-- `CommercialGuaranteeSummary.reference` existed in the API contract but was hardcoded null,
-- because there was nowhere to read it from. Without it a guarantee row is identifiable only
-- by type plus issuer, which stops working the moment a project has two performance bonds
-- from the same bank.
--
-- Nullable by design: rows created before this column have no reference, and a fabricated
-- one would be worse than an empty cell.
ALTER TABLE "contract_guarantees" ADD COLUMN "reference" VARCHAR(50);
