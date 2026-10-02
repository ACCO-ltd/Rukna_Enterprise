-- ADR-042 phase 2 — communication core: one row per business-initiated message (WhatsApp today).
-- Idempotent on (organization_id, idempotency_key); provider_message_id is unique so a webhook
-- status update finds exactly one row.

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "MessagePurpose" AS ENUM ('INVOICE', 'RECEIPT', 'PAYMENT_REMINDER', 'OVERDUE_REMINDER');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "outbound_messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "purpose" "MessagePurpose" NOT NULL,
    "client_id" TEXT,
    "recipient" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "template_name" TEXT,
    "template_language" TEXT,
    "provider_message_id" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "error_code" TEXT,
    "error_message" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbound_messages_provider_message_id_key" ON "outbound_messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "outbound_messages_org_resource_idx" ON "outbound_messages"("organization_id", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "outbound_messages_org_client_idx" ON "outbound_messages"("organization_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_messages_org_idempotency_key" ON "outbound_messages"("organization_id", "idempotency_key");

