-- CreateTable
CREATE TABLE "client_invoice_attachments" (
    "id" TEXT NOT NULL,
    "client_invoice_id" TEXT NOT NULL,
    "platform_file_id" TEXT NOT NULL,
    "is_post_submission" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "client_invoice_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_bill_attachments" (
    "id" TEXT NOT NULL,
    "supplier_bill_id" TEXT NOT NULL,
    "platform_file_id" TEXT NOT NULL,
    "is_post_submission" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "supplier_bill_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payment_attachments" (
    "id" TEXT NOT NULL,
    "supplier_payment_id" TEXT NOT NULL,
    "platform_file_id" TEXT NOT NULL,
    "is_post_submission" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "supplier_payment_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_receipt_attachments" (
    "id" TEXT NOT NULL,
    "payment_receipt_id" TEXT NOT NULL,
    "platform_file_id" TEXT NOT NULL,
    "is_post_submission" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "payment_receipt_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_invoice_attachments_client_invoice_id_idx" ON "client_invoice_attachments"("client_invoice_id");

-- CreateIndex
CREATE INDEX "supplier_bill_attachments_supplier_bill_id_idx" ON "supplier_bill_attachments"("supplier_bill_id");

-- CreateIndex
CREATE INDEX "supplier_payment_attachments_supplier_payment_id_idx" ON "supplier_payment_attachments"("supplier_payment_id");

-- CreateIndex
CREATE INDEX "payment_receipt_attachments_payment_receipt_id_idx" ON "payment_receipt_attachments"("payment_receipt_id");

-- AddForeignKey
ALTER TABLE "client_invoice_attachments" ADD CONSTRAINT "client_invoice_attachments_client_invoice_id_fkey" FOREIGN KEY ("client_invoice_id") REFERENCES "client_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoice_attachments" ADD CONSTRAINT "client_invoice_attachments_platform_file_id_fkey" FOREIGN KEY ("platform_file_id") REFERENCES "platform_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bill_attachments" ADD CONSTRAINT "supplier_bill_attachments_supplier_bill_id_fkey" FOREIGN KEY ("supplier_bill_id") REFERENCES "supplier_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bill_attachments" ADD CONSTRAINT "supplier_bill_attachments_platform_file_id_fkey" FOREIGN KEY ("platform_file_id") REFERENCES "platform_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_attachments" ADD CONSTRAINT "supplier_payment_attachments_supplier_payment_id_fkey" FOREIGN KEY ("supplier_payment_id") REFERENCES "supplier_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_attachments" ADD CONSTRAINT "supplier_payment_attachments_platform_file_id_fkey" FOREIGN KEY ("platform_file_id") REFERENCES "platform_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipt_attachments" ADD CONSTRAINT "payment_receipt_attachments_payment_receipt_id_fkey" FOREIGN KEY ("payment_receipt_id") REFERENCES "payment_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipt_attachments" ADD CONSTRAINT "payment_receipt_attachments_platform_file_id_fkey" FOREIGN KEY ("platform_file_id") REFERENCES "platform_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

