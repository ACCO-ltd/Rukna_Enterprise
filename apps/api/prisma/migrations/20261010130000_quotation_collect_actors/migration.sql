-- ADR-044 review H2 — record every actor who touched a quotation's evidence, so
-- QUOTE_UPLOADER_CANNOT_SELECT covers whoever withdrew a quote, sent (incl. with a count
-- exception) or reopened the request. Additive; no backfill (no live data).

-- AlterTable
ALTER TABLE "quotation_quotes" ADD COLUMN     "withdrawn_by" TEXT;

-- AlterTable
ALTER TABLE "quotation_requests" ADD COLUMN     "collect_actor_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

