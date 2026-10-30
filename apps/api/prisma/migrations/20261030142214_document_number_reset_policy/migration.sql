-- CreateEnum
CREATE TYPE "NumberResetPolicy" AS ENUM ('NEVER', 'YEARLY', 'MONTHLY', 'DAILY');

-- AlterTable
ALTER TABLE "document_number_sequences" ADD COLUMN     "reset_policy" "NumberResetPolicy" NOT NULL DEFAULT 'NEVER',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "document_number_period_counters" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sequence_id" TEXT NOT NULL,
    "period_key" VARCHAR(10) NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_number_period_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_number_period_counters_organization_id_idx" ON "document_number_period_counters"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_number_period_counters_sequence_id_period_key_key" ON "document_number_period_counters"("sequence_id", "period_key");

-- AddForeignKey
ALTER TABLE "document_number_period_counters" ADD CONSTRAINT "document_number_period_counters_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "document_number_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
