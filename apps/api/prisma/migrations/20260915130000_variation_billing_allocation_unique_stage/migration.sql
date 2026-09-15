-- ADR-030 CONST-COM-028 (Commercial redesign, C5 hardening) — the concurrency backstop for the
-- exactly-once variation-billing invariant.
--
-- C5's orchestrator guards a re-run by looking up an existing INVOICE allocation before raising a
-- second invoice, but that read-then-write is not safe against a true concurrent double-submit of
-- "bill this stage" (two transactions both see no allocation, both insert). The milestone invoice is
-- already protected by unique(source_installment_id); this closes the same gap on the variation side.
--
-- A VO's net is a single sign, so it is billed AT MOST ONCE onto a given stage — hence at most one
-- allocation per (variation_id, installment_id). A racing second insert now fails and rolls its whole
-- transaction back (no duplicate invoice). Additive + safe to backfill: every existing allocation has a
-- NULL installment_id (C4 wrote none; C5's own rows are one-per-stage), and Postgres treats NULLs as
-- DISTINCT in a unique index, so off-stage (standalone) allocations are never constrained.

CREATE UNIQUE INDEX "variation_billing_allocations_variation_id_installment_id_key" ON "variation_billing_allocations"("variation_id", "installment_id");
