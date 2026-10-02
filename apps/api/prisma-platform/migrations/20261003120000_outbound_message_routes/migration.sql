-- ADR-042 phase 2 — provider message id -> tenant, so the public WhatsApp webhook (no tenant
-- subdomain) can route a status update to the tenant DB that holds the OutboundMessage.

-- CreateTable
CREATE TABLE "outbound_message_routes" (
    "provider_message_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_message_routes_pkey" PRIMARY KEY ("provider_message_id")
);

-- CreateIndex
CREATE INDEX "outbound_message_routes_tenant_id_idx" ON "outbound_message_routes"("tenant_id");

-- AddForeignKey
ALTER TABLE "outbound_message_routes" ADD CONSTRAINT "outbound_message_routes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

