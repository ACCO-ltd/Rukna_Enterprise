-- Step 1b (ADR-047): per-company editable copies of the platform templates. NULL = platform default.
ALTER TABLE "organizations" ADD COLUMN     "payment_plan_template" JSONB,
ADD COLUMN     "schedule_template" JSONB;
