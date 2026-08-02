-- Migration: auth_refresh_token_jti_family
-- Replaces the bcrypt-hash `token` column with a `jti` (JWT ID) lookup field.
-- Token family tracking added for refresh token reuse detection (ADR-004 Decision 20).

-- Clear all existing refresh tokens — they were issued under the old format and
-- cannot be migrated (no jti embedded in the signed JWT). Users will re-authenticate.
DELETE FROM "refresh_tokens";

-- Drop the old bcrypt-hash column and its unique index
ALTER TABLE "refresh_tokens" DROP COLUMN "token";

-- Add jti — the JWT ID embedded in the signed refresh token; used for O(1) lookup
ALTER TABLE "refresh_tokens" ADD COLUMN "jti" TEXT NOT NULL DEFAULT '';
ALTER TABLE "refresh_tokens" ADD COLUMN "token_family_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "refresh_tokens" ADD COLUMN "device_hint" TEXT;

-- Remove temporary defaults (new rows must supply values explicitly)
ALTER TABLE "refresh_tokens" ALTER COLUMN "jti" DROP DEFAULT;
ALTER TABLE "refresh_tokens" ALTER COLUMN "token_family_id" DROP DEFAULT;

-- Unique constraint on jti — one record per issued token
CREATE UNIQUE INDEX "refresh_tokens_jti_key" ON "refresh_tokens"("jti");

-- Index on token_family_id — used when revoking all tokens in a compromised family
CREATE INDEX "refresh_tokens_token_family_id_idx" ON "refresh_tokens"("token_family_id");
