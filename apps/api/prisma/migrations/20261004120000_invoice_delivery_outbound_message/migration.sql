-- ADR-042 — WhatsApp V1 step 2 (send invoice): a delivery recorded for a message Rukna sent links to
-- its OutboundMessage. Unique, so a repeated send / manual resolve records the delivery once.
-- Additive and nullable: hand-recorded deliveries keep NULL.

-- AlterTable
ALTER TABLE "client_invoice_deliveries" ADD COLUMN "outbound_message_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "client_invoice_deliveries_outbound_message_id_key" ON "client_invoice_deliveries"("outbound_message_id");
