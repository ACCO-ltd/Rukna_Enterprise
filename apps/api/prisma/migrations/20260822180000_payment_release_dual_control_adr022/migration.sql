-- ADR-022 CONST-DOA-005 — bank-signatory dual control on payment release.

-- New RELEASED state between APPROVED and posting (only reached for accounts with signatories).
ALTER TYPE "PaymentDocStatus" ADD VALUE 'RELEASED' AFTER 'APPROVED';

-- Authorized signatories per bank account.
CREATE TABLE "bank_account_signatories" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "added_by" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    CONSTRAINT "bank_account_signatories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bank_account_signatories_bank_account_id_user_id_key" ON "bank_account_signatories"("bank_account_id", "user_id");
CREATE INDEX "bank_account_signatories_organization_id_bank_account_id_is_idx" ON "bank_account_signatories"("organization_id", "bank_account_id", "is_active");
ALTER TABLE "bank_account_signatories" ADD CONSTRAINT "bank_account_signatories_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One signatory's signature releasing a payment; two distinct ones flip the payment to RELEASED.
CREATE TABLE "payment_release_signatures" (
    "id" TEXT NOT NULL,
    "supplier_payment_id" TEXT NOT NULL,
    "signatory_user_id" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_release_signatures_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_release_signatures_supplier_payment_id_signatory_us_key" ON "payment_release_signatures"("supplier_payment_id", "signatory_user_id");
CREATE INDEX "payment_release_signatures_supplier_payment_id_idx" ON "payment_release_signatures"("supplier_payment_id");
ALTER TABLE "payment_release_signatures" ADD CONSTRAINT "payment_release_signatures_supplier_payment_id_fkey" FOREIGN KEY ("supplier_payment_id") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
