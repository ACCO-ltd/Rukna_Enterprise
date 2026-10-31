-- Remove VAT from the platform (ADR-050). The organisation is not registered for VAT: no tax
-- codes, no VAT on invoices, credit notes or bills, no VAT accounts.
--
-- Refuse to run where VAT was ever charged: dropping these columns would lose a figure the ledger
-- still holds. Such a database needs its VAT moved out by journal first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM client_invoices WHERE vat_amount <> 0)
     OR EXISTS (SELECT 1 FROM credit_notes WHERE vat_amount <> 0)
     OR EXISTS (SELECT 1 FROM supplier_bills WHERE vat_amount <> 0)
     OR EXISTS (SELECT 1 FROM supplier_bill_lines WHERE vat_amount <> 0 OR gross_amount <> net_amount) THEN
    RAISE EXCEPTION 'VAT has been charged on documents in this database; clear it before removing VAT.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM journal_lines jl JOIN account_versions v ON v.account_id = jl.account_id
    WHERE v.account_subtype IN ('VAT_OUTPUT_PAYABLE', 'VAT_INPUT_RECOVERABLE')
  ) THEN
    RAISE EXCEPTION 'A VAT account has ledger entries; move them to another account before removing VAT.';
  END IF;
END $$;

-- A VAT account that never took an entry becomes an ordinary account, open to manual entries.
UPDATE account_versions
SET account_subtype = 'OTHER_CURRENT_LIABILITY', control_posting_policy = 'UNRESTRICTED'
WHERE account_subtype = 'VAT_OUTPUT_PAYABLE';
UPDATE account_versions
SET account_subtype = 'OTHER_CURRENT_ASSET', control_posting_policy = 'UNRESTRICTED'
WHERE account_subtype = 'VAT_INPUT_RECOVERABLE';
DELETE FROM posting_rule_line_templates WHERE account_subtype IN ('VAT_OUTPUT_PAYABLE', 'VAT_INPUT_RECOVERABLE');

-- AlterEnum
BEGIN;
CREATE TYPE "AccountSubtype_new" AS ENUM ('CASH_AND_BANK', 'ACCOUNTS_RECEIVABLE', 'RETENTION_RECEIVABLE', 'UNAPPLIED_CLIENT_RECEIPTS', 'SUPPLIER_ADVANCE', 'INVENTORY', 'FIXED_ASSETS', 'ACCUMULATED_DEPRECIATION', 'PREPAYMENTS', 'OTHER_CURRENT_ASSET', 'OTHER_NON_CURRENT_ASSET', 'ACCOUNTS_PAYABLE', 'CLIENT_ADVANCE_LIABILITY', 'OTHER_CURRENT_LIABILITY', 'OTHER_NON_CURRENT_LIABILITY', 'SHARE_CAPITAL', 'RETAINED_EARNINGS', 'CURRENT_YEAR_EARNINGS', 'OTHER_EQUITY', 'PROJECT_REVENUE', 'OTHER_INCOME', 'MATERIAL_COST', 'SUBCONTRACT_COST', 'DIRECT_LABOUR', 'OTHER_DIRECT_COST', 'ADMINISTRATIVE_EXPENSE', 'DEPRECIATION_EXPENSE', 'FINANCE_COST', 'BAD_DEBT_EXPENSE', 'OTHER_EXPENSE');
ALTER TABLE "account_versions" ALTER COLUMN "account_subtype" TYPE "AccountSubtype_new" USING ("account_subtype"::text::"AccountSubtype_new");
ALTER TABLE "posting_rule_line_templates" ALTER COLUMN "account_subtype" TYPE "AccountSubtype_new" USING ("account_subtype"::text::"AccountSubtype_new");
ALTER TYPE "AccountSubtype" RENAME TO "AccountSubtype_old";
ALTER TYPE "AccountSubtype_new" RENAME TO "AccountSubtype";
DROP TYPE "public"."AccountSubtype_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "client_invoices" DROP CONSTRAINT "client_invoices_tax_code_id_fkey";

-- DropForeignKey
ALTER TABLE "tax_codes" DROP CONSTRAINT "tax_codes_organization_id_fkey";

-- DropIndex
DROP INDEX "client_invoices_tax_code_id_idx";

-- AlterTable
ALTER TABLE "client_invoices" DROP COLUMN "tax_code_id",
DROP COLUMN "tax_rate",
DROP COLUMN "vat_amount";

-- AlterTable
ALTER TABLE "credit_notes" DROP COLUMN "vat_amount";

-- AlterTable
ALTER TABLE "journal_lines" DROP COLUMN "tax_code_id";

-- AlterTable
ALTER TABLE "purchase_order_lines" DROP COLUMN "tax_code_id";

-- AlterTable
ALTER TABLE "supplier_bill_lines" DROP COLUMN "gross_amount",
DROP COLUMN "vat_amount",
DROP COLUMN "vat_code_id";

-- AlterTable
ALTER TABLE "supplier_bills" DROP COLUMN "vat_amount";

-- DropTable
DROP TABLE "tax_codes";

-- DropTable
DROP TABLE "tax_policy";

-- DropEnum
DROP TYPE "RecoveryMethod";

-- DropEnum
DROP TYPE "TaxCodeStatus";

-- DropEnum
DROP TYPE "TaxDirection";

-- DropEnum
DROP TYPE "TaxType";

