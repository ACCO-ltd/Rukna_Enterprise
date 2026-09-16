-- Collapse the contract lifecycle to DRAFT → ACTIVE (+ reopen).
--
-- ACCO signs its contracts on paper, so the in-app UNDER_REVIEW and PENDING_SIGNATURE stages are
-- retired from the operative flow (see contract.service.ts TRANSITIONS). This is a DATA-ONLY sweep:
-- any contract still sitting in one of those pre-live states is moved back to DRAFT, from which it
-- can be activated directly. Both states are pre-billing, so this is non-destructive.
--
-- The ContractStatus enum keeps all eight values — UNDER_REVIEW / PENDING_SIGNATURE become dormant
-- (no rows, no reachable transition) rather than being dropped, so there is NO Postgres enum surgery
-- and no risk to historical audit rows that reference the labels.

UPDATE "contracts"
SET "status" = 'DRAFT'
WHERE "status" IN ('UNDER_REVIEW', 'PENDING_SIGNATURE');
