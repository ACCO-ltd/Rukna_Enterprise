-- Invoice PDF redesign: the organisation's invoice document settings — the bank account printed
-- under "Payment Information", the invoice notes and the authorised signatory. One row per
-- organisation; absent row = no bank card, default notes, blank signature line.
CREATE TABLE "invoice_document_policy" (
    "organization_id" TEXT NOT NULL,
    "bank_account_id" TEXT,
    "notes" TEXT,
    "signatory_user_id" TEXT,
    "signatory_title" VARCHAR(120),
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_document_policy_pkey" PRIMARY KEY ("organization_id")
);
