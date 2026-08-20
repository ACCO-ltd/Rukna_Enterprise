-- DropForeignKey
ALTER TABLE "exchange_rates" DROP CONSTRAINT "exchange_rates_organization_id_fkey";

-- AlterTable
ALTER TABLE "approval_instances" DROP COLUMN "reporting_currency_code";

-- AlterTable
ALTER TABLE "client_invoices" DROP COLUMN "exchange_rate_date",
DROP COLUMN "exchange_rate_snapshot",
DROP COLUMN "exchange_rate_source";

-- AlterTable
ALTER TABLE "commitment_ledger_entries" DROP COLUMN "exchange_rate_snapshot";

-- AlterTable
ALTER TABLE "interim_payment_applications" DROP COLUMN "exchange_rate_base",
DROP COLUMN "exchange_rate_currency",
DROP COLUMN "exchange_rate_date",
DROP COLUMN "exchange_rate_value";

-- AlterTable
ALTER TABLE "interim_payment_certificates" DROP COLUMN "exchange_rate_base",
DROP COLUMN "exchange_rate_currency",
DROP COLUMN "exchange_rate_date",
DROP COLUMN "exchange_rate_value";

-- AlterTable
ALTER TABLE "journal_entries" DROP COLUMN "exchange_rate_snapshot";

-- AlterTable
ALTER TABLE "journal_lines" DROP COLUMN "base_currency_amount",
DROP COLUMN "exchange_rate_snapshot",
DROP COLUMN "transaction_amount",
DROP COLUMN "transaction_currency_code";

-- AlterTable
ALTER TABLE "payment_receipts" DROP COLUMN "exchange_rate_date",
DROP COLUMN "exchange_rate_snapshot",
DROP COLUMN "exchange_rate_source";

-- AlterTable
ALTER TABLE "period_account_balances" DROP COLUMN "base_currency";

-- AlterTable
ALTER TABLE "supplier_bills" DROP COLUMN "exchange_rate_date",
DROP COLUMN "exchange_rate_snapshot",
DROP COLUMN "exchange_rate_source";

-- AlterTable
ALTER TABLE "supplier_payments" DROP COLUMN "exchange_rate_date",
DROP COLUMN "exchange_rate_snapshot",
DROP COLUMN "exchange_rate_source";

-- AlterTable
ALTER TABLE "workflow_policy_versions" DROP COLUMN "reporting_currency";

-- DropTable
DROP TABLE "exchange_rates";

-- DropTable
DROP TABLE "monetary_policy";

