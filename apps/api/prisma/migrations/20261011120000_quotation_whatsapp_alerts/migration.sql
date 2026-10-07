-- ADR-044 phase 2 — WhatsApp alerts to staff for quotation events + the 2h/4h SLA reminder and
-- escalation. Additive only: new MessagePurpose values, background-send columns on
-- outbound_messages (client messages keep next_attempt_at NULL and are never picked up by the
-- dispatcher), and an opt-in staff WhatsApp number on users. No backfill.

-- AlterEnum (PostgreSQL 12+: ADD VALUE inside the migration transaction; the values are not used here)
ALTER TYPE "MessagePurpose" ADD VALUE 'QUOTE_READY';
ALTER TYPE "MessagePurpose" ADD VALUE 'QUOTE_REMINDER';
ALTER TYPE "MessagePurpose" ADD VALUE 'QUOTE_ESCALATION';
ALTER TYPE "MessagePurpose" ADD VALUE 'QUOTE_CHOSEN';
ALTER TYPE "MessagePurpose" ADD VALUE 'QUOTE_ANOTHER';

-- AlterTable
ALTER TABLE "outbound_messages" ADD COLUMN     "attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "next_attempt_at" TIMESTAMP(3),
ADD COLUMN     "recipient_user_id" TEXT,
ADD COLUMN     "template_params" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "whatsapp_alerts_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsapp_phone" VARCHAR(16);

-- A staff number is E.164 with the leading '+' (validated by the API too; this is the backstop).
ALTER TABLE "users" ADD CONSTRAINT "users_whatsapp_phone_e164"
  CHECK ("whatsapp_phone" IS NULL OR "whatsapp_phone" ~ '^\+[1-9][0-9]{7,14}$');

-- CreateIndex
CREATE INDEX "outbound_messages_dispatch_idx" ON "outbound_messages"("status", "next_attempt_at");
