-- ADR-031: persistent in-app notifications. Purely additive — one new table + two enums, no
-- change to any existing table, so this is a safe live migration with no backfill.

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('STAGE_PAYMENT_DUE', 'STAGE_PAYMENT_OVERDUE', 'CLIENT_INVOICE_OVERDUE');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'URGENT');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "recipient_user_id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "project_id" TEXT,
    "contract_id" TEXT,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "context_data" JSONB,
    "action_url" TEXT,
    "read_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_org_recipient_read_resolved_idx" ON "notifications"("organization_id", "recipient_user_id", "read_at", "resolved_at");

-- CreateIndex
CREATE INDEX "notifications_org_resource_idx" ON "notifications"("organization_id", "resource_type", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_org_recipient_dedupe_key" ON "notifications"("organization_id", "recipient_user_id", "dedupe_key");
