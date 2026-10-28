-- ADR-048: hand-typed invoices for non-contract sales — the flag and their lines.
-- AlterTable
ALTER TABLE "client_invoices" ADD COLUMN     "is_manual" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "client_invoice_lines" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL,
    "revenue_account_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_invoice_lines_organization_id_invoice_id_idx" ON "client_invoice_lines"("organization_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_invoice_lines_invoice_id_line_no_key" ON "client_invoice_lines"("invoice_id", "line_no");

-- AddForeignKey
ALTER TABLE "client_invoice_lines" ADD CONSTRAINT "client_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "client_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoice_lines" ADD CONSTRAINT "client_invoice_lines_revenue_account_id_fkey" FOREIGN KEY ("revenue_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

