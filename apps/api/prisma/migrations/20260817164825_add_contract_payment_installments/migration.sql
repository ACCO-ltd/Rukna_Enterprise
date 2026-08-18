-- CreateEnum
CREATE TYPE "PaymentTrigger" AS ENUM ('ADVANCE', 'TIME_BASED', 'MILESTONE');

-- CreateTable
CREATE TABLE "contract_payment_installments" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "percentage" DECIMAL(5,4) NOT NULL,
    "trigger_type" "PaymentTrigger" NOT NULL,
    "due_offset_days" INTEGER,
    "due_date" DATE,
    "milestone_label" TEXT,

    CONSTRAINT "contract_payment_installments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_payment_installments_contract_id_idx" ON "contract_payment_installments"("contract_id");

-- AddForeignKey
ALTER TABLE "contract_payment_installments" ADD CONSTRAINT "contract_payment_installments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
