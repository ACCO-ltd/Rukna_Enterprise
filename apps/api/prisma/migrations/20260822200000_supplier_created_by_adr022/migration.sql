-- ADR-022 CONST-DOA-003 — record the vendor maintainer so the VENDOR_MAINTAINER segregation-of-
-- duties rule can fire. Nullable: suppliers created before this column have an unknown maintainer.
ALTER TABLE "suppliers" ADD COLUMN "created_by" TEXT;
