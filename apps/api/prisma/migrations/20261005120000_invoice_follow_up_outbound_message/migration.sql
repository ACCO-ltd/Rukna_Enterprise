-- ADR-042 — WhatsApp V1 step 4 (manual payment / overdue reminder): a follow-up recorded for a
-- reminder Rukna sent links to its OutboundMessage. Unique, so a repeated send / webhook / manual
-- resolve records the follow-up once. Additive and nullable: hand-recorded follow-ups keep NULL.

-- AlterTable
ALTER TABLE "invoice_follow_ups" ADD COLUMN "outbound_message_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "invoice_follow_ups_outbound_message_id_key" ON "invoice_follow_ups"("outbound_message_id");
