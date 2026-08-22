-- ADR-022 CONST-DOA-005 value-threshold routing. A workflow trigger binding may now be scoped to
-- an amount band, so the same transition can route to different approval chains by document value.
-- Both columns null = unbounded (catch-all). Range is half-open [min_amount, max_amount).
ALTER TABLE "workflow_trigger_bindings" ADD COLUMN "min_amount" DECIMAL(18,2);
ALTER TABLE "workflow_trigger_bindings" ADD COLUMN "max_amount" DECIMAL(18,2);
