-- CreateEnum
CREATE TYPE "DocumentReadingKind" AS ENUM ('DELIVERY_NOTE', 'RECEIPT', 'QUOTE', 'MATERIAL_LIST');

-- CreateEnum
CREATE TYPE "DocumentReadingStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "document_reader_policy" (
    "organization_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_reader_policy_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "document_readings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "platform_file_id" TEXT NOT NULL,
    "kind" "DocumentReadingKind" NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "status" "DocumentReadingStatus" NOT NULL,
    "result" JSONB,
    "error_code" VARCHAR(60),
    "duration_ms" INTEGER NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_readings_organization_id_created_at_idx" ON "document_readings"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "document_readings_platform_file_id_idx" ON "document_readings"("platform_file_id");

