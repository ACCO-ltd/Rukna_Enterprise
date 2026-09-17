-- Collapse the variation lifecycle: retire the approval workflow.
--
-- variation-collapse — the VariationOrder approval workflow (submit → internal-approve →
-- client-approve) was removed. A variation raised via the BOQ "Add Extra Work" drawer now lands
-- CLIENT_APPROVED + adopted-to-BOQ in one atomic step (ApplyVariationToBoqService.raiseAndAdopt), and
-- is un-adopted (→ WITHDRAWN) via the reverse command. The two intermediate statuses are no longer
-- reachable by any operative command.
--
-- This is a DATA-ONLY sweep: any variation still sitting in one of the dormant pre-approval states is
-- moved back to DRAFT (from which the drawer path can re-raise it). Both states are pre-adopt /
-- pre-billing, so this is non-destructive — a PENDING_INTERNAL / INTERNAL_APPROVED VO has neither
-- raised the contract value nor produced any BOQ node or billing allocation.
--
-- The VariationOrderStatus enum keeps all six values — PENDING_INTERNAL / INTERNAL_APPROVED become
-- dormant (no rows, no reachable transition) rather than being dropped, so there is NO Postgres enum
-- surgery and no risk to historical audit rows that reference the labels.

UPDATE "variation_orders"
SET "status" = 'DRAFT'
WHERE "status" IN ('PENDING_INTERNAL', 'INTERNAL_APPROVED');
