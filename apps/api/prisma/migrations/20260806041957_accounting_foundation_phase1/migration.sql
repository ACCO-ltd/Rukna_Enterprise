/*
  Warnings:

  - You are about to drop the column `amount` on the `payment_receipts` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `payment_receipts` table. All the data in the column will be lost.
  - You are about to drop the column `exchange_rate` on the `payment_receipts` table. All the data in the column will be lost.
  - Added the required column `accounting_date` to the `payment_receipts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `currency_code` to the `payment_receipts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `total_amount` to the `payment_receipts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unallocated_amount` to the `payment_receipts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `payment_receipts` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DimensionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "AccountClass" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'COST_OF_SALES', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AccountSubtype" AS ENUM ('CASH_AND_BANK', 'ACCOUNTS_RECEIVABLE', 'UNAPPLIED_CLIENT_RECEIPTS', 'SUPPLIER_ADVANCE', 'INVENTORY', 'FIXED_ASSETS', 'ACCUMULATED_DEPRECIATION', 'PREPAYMENTS', 'OTHER_CURRENT_ASSET', 'OTHER_NON_CURRENT_ASSET', 'ACCOUNTS_PAYABLE', 'CLIENT_ADVANCE_LIABILITY', 'VAT_OUTPUT_PAYABLE', 'VAT_INPUT_RECOVERABLE', 'OTHER_CURRENT_LIABILITY', 'OTHER_NON_CURRENT_LIABILITY', 'SHARE_CAPITAL', 'RETAINED_EARNINGS', 'CURRENT_YEAR_EARNINGS', 'OTHER_EQUITY', 'PROJECT_REVENUE', 'OTHER_INCOME', 'MATERIAL_COST', 'SUBCONTRACT_COST', 'DIRECT_LABOUR', 'OTHER_DIRECT_COST', 'ADMINISTRATIVE_EXPENSE', 'DEPRECIATION_EXPENSE', 'FINANCE_COST', 'OTHER_EXPENSE');

-- CreateEnum
CREATE TYPE "ControlPostingPolicy" AS ENUM ('UNRESTRICTED', 'SYSTEM_ONLY', 'SYSTEM_OR_APPROVED_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SubledgerType" AS ENUM ('ACCOUNTS_RECEIVABLE', 'ACCOUNTS_PAYABLE', 'INVENTORY', 'BANK');

-- CreateEnum
CREATE TYPE "FiscalYearStatus" AS ENUM ('DRAFT', 'OPEN', 'LOCKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'LOCKED', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('OPERATING', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BankAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('VAT', 'WITHHOLDING', 'OTHER');

-- CreateEnum
CREATE TYPE "RecoveryMethod" AS ENUM ('FULLY_RECOVERABLE', 'NON_RECOVERABLE', 'PARTIALLY_RECOVERABLE');

-- CreateEnum
CREATE TYPE "TaxCodeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ProfileStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('DRAFT', 'APPROVED', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DebitCredit" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "ResolutionType" AS ENUM ('FIXED_ACCOUNT', 'ACCOUNT_SUBTYPE_LOOKUP', 'POSTING_PROFILE', 'SUBLEDGER_LOOKUP');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CLIENT_INVOICE', 'PAYMENT_RECEIPT', 'SUPPLIER_BILL', 'SUPPLIER_PAYMENT', 'JOURNAL_ENTRY');

-- CreateEnum
CREATE TYPE "SequenceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "JournalCategory" AS ENUM ('GENERAL', 'ACCOUNTS_RECEIVABLE', 'ACCOUNTS_PAYABLE', 'CASH_AND_BANK', 'OPENING_BALANCE', 'CLOSING_ADJUSTMENT', 'YEAR_END_CLOSE', 'REVERSAL', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "EntryPurpose" AS ENUM ('NORMAL', 'REVERSAL', 'REPLACEMENT', 'CLOSING', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "InvoiceDocStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PostingStatus" AS ENUM ('NOT_POSTED', 'PENDING', 'POSTED', 'FAILED', 'REVERSED', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "BillDocStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentDocStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PostingOrigin" AS ENUM ('SYSTEM_AR', 'SYSTEM_AP', 'SYSTEM_CASH', 'SYSTEM_OPENING', 'SYSTEM_YEAR_END', 'MANUAL');

-- CreateEnum
CREATE TYPE "SourceDocType" AS ENUM ('CLIENT_INVOICE', 'PAYMENT_RECEIPT', 'SUPPLIER_BILL', 'SUPPLIER_PAYMENT', 'MANUAL_JOURNAL', 'OPENING_BALANCE', 'YEAR_END_CLOSE');

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('SUCCESS', 'FAILURE_VALIDATION', 'FAILURE_BALANCE_CHECK', 'FAILURE_PERIOD_CLOSED', 'FAILURE_CONTROL_ACCOUNT', 'FAILURE_SYSTEM_ERROR');

-- CreateEnum
CREATE TYPE "MigrationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'RESOLVED', 'WAIVED');

-- CreateEnum
CREATE TYPE "SnapshotStatus" AS ENUM ('VALID', 'INVALID', 'REBUILDING');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('UNREVIEWED', 'IN_BALANCE', 'VARIANCE_ACKNOWLEDGED', 'EXCEPTION_RAISED');

-- CreateEnum
CREATE TYPE "NumberingScope" AS ENUM ('CONTINUOUS', 'RESET_ANNUALLY');

-- CreateEnum
CREATE TYPE "DimensionRequirement" AS ENUM ('REQUIRED', 'OPTIONAL', 'PROHIBITED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WorkflowTransactionType" ADD VALUE 'CLIENT_INVOICE';
ALTER TYPE "WorkflowTransactionType" ADD VALUE 'SUPPLIER_BILL';
ALTER TYPE "WorkflowTransactionType" ADD VALUE 'PAYMENT_RECEIPT';
ALTER TYPE "WorkflowTransactionType" ADD VALUE 'MANUAL_JOURNAL';

-- DropForeignKey
ALTER TABLE "boq_nodes" DROP CONSTRAINT "boq_nodes_boq_id_fkey";

-- AlterTable
ALTER TABLE "payment_receipts" DROP COLUMN "amount",
DROP COLUMN "currency",
DROP COLUMN "exchange_rate",
ADD COLUMN     "accounting_date" DATE NOT NULL,
ADD COLUMN     "allocated_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" TEXT,
ADD COLUMN     "bank_account_id" TEXT,
ADD COLUMN     "bank_reference" TEXT,
ADD COLUMN     "currency_code" VARCHAR(3) NOT NULL,
ADD COLUMN     "document_status" "PaymentDocStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "exchange_rate_date" DATE,
ADD COLUMN     "exchange_rate_snapshot" DECIMAL(18,6),
ADD COLUMN     "exchange_rate_source" TEXT,
ADD COLUMN     "last_posting_attempt_at" TIMESTAMP(3),
ADD COLUMN     "last_posting_error_code" TEXT,
ADD COLUMN     "migration_batch_id" TEXT,
ADD COLUMN     "payment_method" TEXT,
ADD COLUMN     "posted_at" TIMESTAMP(3),
ADD COLUMN     "posted_by" TEXT,
ADD COLUMN     "posted_journal_entry_id" TEXT,
ADD COLUMN     "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "total_amount" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "unallocated_amount" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "status" "DimensionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_versions" (
    "id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "parent_department_id" TEXT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "changed_by" TEXT NOT NULL,
    "change_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "department_id" TEXT NOT NULL,
    "status" "DimensionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_center_versions" (
    "id" TEXT NOT NULL,
    "cost_center_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "changed_by" TEXT NOT NULL,
    "change_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_center_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "normal_balance" "NormalBalance" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_versions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "parent_account_id" TEXT,
    "account_class" "AccountClass" NOT NULL,
    "account_subtype" "AccountSubtype" NOT NULL,
    "is_posting_allowed" BOOLEAN NOT NULL DEFAULT true,
    "is_control_account" BOOLEAN NOT NULL DEFAULT false,
    "controlled_subledger_type" "SubledgerType",
    "control_posting_policy" "ControlPostingPolicy" NOT NULL DEFAULT 'UNRESTRICTED',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "changed_by" TEXT NOT NULL,
    "change_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_years" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" VARCHAR(20) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "retained_earnings_account_id" TEXT NOT NULL,
    "status" "FiscalYearStatus" NOT NULL DEFAULT 'DRAFT',
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" TEXT NOT NULL,
    "fiscal_year_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period_number" INTEGER NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "period_type" "PeriodType" NOT NULL DEFAULT 'OPERATING',
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "reopen_reason" TEXT,
    "reopened_by" TEXT,
    "reopened_at" TIMESTAMP(3),
    "reopen_approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_groups" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DimensionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "treasury_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "gl_account_id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number" VARCHAR(50) NOT NULL,
    "iban" VARCHAR(34),
    "swift_code" VARCHAR(11),
    "currency_code" VARCHAR(3) NOT NULL,
    "branch" TEXT,
    "treasury_group_id" TEXT,
    "allows_receipts" BOOLEAN NOT NULL DEFAULT true,
    "allows_payments" BOOLEAN NOT NULL DEFAULT true,
    "is_reconcilable" BOOLEAN NOT NULL DEFAULT true,
    "status" "BankAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "opened_at" DATE,
    "closed_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_codes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "rate" DECIMAL(7,4) NOT NULL,
    "tax_type" "TaxType" NOT NULL,
    "recovery_method" "RecoveryMethod" NOT NULL,
    "output_tax_account_id" TEXT,
    "input_tax_account_id" TEXT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" "TaxCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "tax_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "tax_number" TEXT,
    "default_currency" VARCHAR(3),
    "payment_terms_days" INTEGER,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_contacts" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "supplier_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_profiles" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "status" "ProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "posting_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_profile_versions" (
    "id" TEXT NOT NULL,
    "posting_profile_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "account_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "changed_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posting_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_rule_versions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" "RuleStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posting_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_rule_line_templates" (
    "id" TEXT NOT NULL,
    "posting_rule_version_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "line_role" TEXT NOT NULL,
    "debit_or_credit" "DebitCredit" NOT NULL,
    "amount_source" TEXT NOT NULL,
    "account_resolution_type" "ResolutionType" NOT NULL,
    "fixed_account_id" TEXT,
    "account_subtype" "AccountSubtype",
    "posting_profile_id" TEXT,
    "condition" TEXT,
    "required_dimensions" TEXT[],
    "description_template" TEXT,

    CONSTRAINT "posting_rule_line_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_number_sequences" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "journal_category" "JournalCategory",
    "prefix" VARCHAR(10) NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "padding_length" INTEGER NOT NULL DEFAULT 6,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "SequenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_invoices" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "invoice_number" VARCHAR(30),
    "invoice_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "client_id" TEXT NOT NULL,
    "source_ipc_id" TEXT NOT NULL,
    "project_id" TEXT,
    "contract_id" TEXT,
    "currency_code" VARCHAR(3) NOT NULL,
    "exchange_rate_snapshot" DECIMAL(18,6) NOT NULL,
    "exchange_rate_date" DATE NOT NULL,
    "exchange_rate_source" TEXT NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "vat_amount" DECIMAL(18,2) NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "outstanding_amount" DECIMAL(18,2) NOT NULL,
    "payment_terms" TEXT,
    "billing_address_snapshot" JSONB NOT NULL,
    "document_status" "InvoiceDocStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "posted_journal_entry_id" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "reversal_journal_entry_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "cancellation_reason" TEXT,
    "last_posting_attempt_at" TIMESTAMP(3),
    "last_posting_error_code" TEXT,
    "migration_batch_id" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_receipt_allocations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "payment_receipt_id" TEXT NOT NULL,
    "client_invoice_id" TEXT NOT NULL,
    "allocated_amount" DECIMAL(18,2) NOT NULL,
    "allocation_date" DATE NOT NULL,
    "journal_entry_id" TEXT,
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "reversal_journal_entry_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_receipt_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_bills" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "bill_number" VARCHAR(30),
    "supplier_invoice_number" TEXT NOT NULL,
    "supplier_invoice_number_norm" TEXT NOT NULL,
    "bill_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL,
    "exchange_rate_snapshot" DECIMAL(18,6) NOT NULL,
    "exchange_rate_date" DATE NOT NULL,
    "exchange_rate_source" TEXT NOT NULL,
    "purchase_order_id" TEXT,
    "project_id" TEXT,
    "department_id" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "vat_amount" DECIMAL(18,2) NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "outstanding_amount" DECIMAL(18,2) NOT NULL,
    "document_status" "BillDocStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "posted_journal_entry_id" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" TEXT,
    "reversal_journal_entry_id" TEXT,
    "last_posting_attempt_at" TIMESTAMP(3),
    "last_posting_error_code" TEXT,
    "migration_batch_id" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_bill_lines" (
    "id" TEXT NOT NULL,
    "supplier_bill_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4),
    "unit_price" DECIMAL(18,4),
    "net_amount" DECIMAL(18,2) NOT NULL,
    "vat_code_id" TEXT,
    "vat_amount" DECIMAL(18,2) NOT NULL,
    "gross_amount" DECIMAL(18,2) NOT NULL,
    "expense_profile_code" VARCHAR(50) NOT NULL,
    "project_id" TEXT,
    "department_id" TEXT,
    "cost_center_id" TEXT,
    "boq_node_id" TEXT,
    "purchase_order_line_id" TEXT,

    CONSTRAINT "supplier_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "payment_number" VARCHAR(30),
    "payment_date" DATE NOT NULL,
    "accounting_date" DATE NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL,
    "exchange_rate_snapshot" DECIMAL(18,6) NOT NULL,
    "exchange_rate_date" DATE NOT NULL,
    "exchange_rate_source" TEXT NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "allocated_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unallocated_amount" DECIMAL(18,2) NOT NULL,
    "payment_method" TEXT NOT NULL,
    "bank_reference" TEXT,
    "notes" TEXT,
    "document_status" "PaymentDocStatus" NOT NULL DEFAULT 'DRAFT',
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "posted_journal_entry_id" TEXT,
    "posted_at" TIMESTAMP(3),
    "posted_by" TEXT,
    "last_posting_attempt_at" TIMESTAMP(3),
    "last_posting_error_code" TEXT,
    "migration_batch_id" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payment_allocations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "supplier_payment_id" TEXT NOT NULL,
    "supplier_bill_id" TEXT NOT NULL,
    "allocated_amount" DECIMAL(18,2) NOT NULL,
    "allocation_date" DATE NOT NULL,
    "journal_entry_id" TEXT,
    "posting_status" "PostingStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "reversal_journal_entry_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "journal_number" VARCHAR(30),
    "accounting_period_id" TEXT,
    "journal_category" "JournalCategory" NOT NULL,
    "entry_purpose" "EntryPurpose" NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "document_date" DATE NOT NULL,
    "accounting_date" DATE NOT NULL,
    "posted_at" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL,
    "exchange_rate_snapshot" DECIMAL(18,6),
    "source_document_type" "SourceDocType",
    "source_document_id" TEXT,
    "accounting_event_id" TEXT,
    "event_version" INTEGER,
    "posting_rule_version_id" TEXT,
    "reversal_of_journal_entry_id" TEXT,
    "replaced_by_journal_entry_id" TEXT,
    "created_by" TEXT NOT NULL,
    "submitted_by" TEXT,
    "submitted_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "posted_by" TEXT,
    "reversed_by" TEXT,
    "reversal_reason" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "account_id" TEXT NOT NULL,
    "account_version_id" TEXT,
    "account_code_snapshot" VARCHAR(20) NOT NULL,
    "account_name_snapshot" TEXT NOT NULL,
    "account_version_number" INTEGER NOT NULL,
    "debit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "transaction_currency_code" VARCHAR(3) NOT NULL,
    "transaction_amount" DECIMAL(18,2),
    "base_currency_amount" DECIMAL(18,2) NOT NULL,
    "exchange_rate_snapshot" DECIMAL(18,6),
    "description" TEXT,
    "posting_origin" "PostingOrigin" NOT NULL,
    "source_subledger_type" "SubledgerType",
    "resolution_source" TEXT,
    "posting_profile_version_id" TEXT,
    "posting_rule_version_id" TEXT,
    "project_id" TEXT,
    "department_id" TEXT,
    "cost_center_id" TEXT,
    "client_id" TEXT,
    "supplier_id" TEXT,
    "contract_id" TEXT,
    "boq_node_id" TEXT,
    "tax_code_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry_attachments" (
    "id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "platform_file_id" TEXT NOT NULL,
    "attachment_type" TEXT,
    "is_post_submission" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "journal_entry_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_account_balances" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "fiscal_year_id" TEXT NOT NULL,
    "accounting_period_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "project_id" TEXT,
    "department_id" TEXT,
    "cost_center_id" TEXT,
    "opening_debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "opening_credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "period_debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "period_credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "closing_debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "closing_credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "base_currency" VARCHAR(3) NOT NULL,
    "snapshot_version" INTEGER NOT NULL DEFAULT 1,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "generated_by" TEXT NOT NULL,
    "status" "SnapshotStatus" NOT NULL DEFAULT 'VALID',

    CONSTRAINT "period_account_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subledger_control_reconciliations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "accounting_period_id" TEXT NOT NULL,
    "gl_closing_balance" DECIMAL(18,2) NOT NULL,
    "subledger_balance" DECIMAL(18,2) NOT NULL,
    "variance" DECIMAL(18,2) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "notes" TEXT,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subledger_control_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_attempts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_document_type" "SourceDocType" NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "source_revision" INTEGER NOT NULL,
    "attempted_by" TEXT NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL,
    "outcome" "AttemptOutcome" NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "posting_rule_version_id" TEXT,
    "journal_entry_id" TEXT,
    "correlation_id" TEXT NOT NULL,

    CONSTRAINT "posting_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_migration_batches" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "performed_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "status" "MigrationStatus" NOT NULL DEFAULT 'PENDING',
    "checksum" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_migration_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_receipt_migration_exceptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "payment_receipt_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_bank_account_id" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_receipt_migration_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monetary_policy" (
    "organization_id" TEXT NOT NULL,
    "base_currency_code" VARCHAR(3) NOT NULL,
    "reporting_currency_code" VARCHAR(3) NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monetary_policy_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "fiscal_calendar_policy" (
    "organization_id" TEXT NOT NULL,
    "fiscal_year_start_month" INTEGER NOT NULL,
    "fiscal_year_start_day" INTEGER NOT NULL,
    "use_adjustment_periods" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_calendar_policy_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "tax_policy" (
    "organization_id" TEXT NOT NULL,
    "default_output_tax_code_id" TEXT,
    "default_input_tax_code_id" TEXT,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_policy_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "numbering_policy" (
    "organization_id" TEXT NOT NULL,
    "numbering_scope" "NumberingScope" NOT NULL DEFAULT 'CONTINUOUS',
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "numbering_policy_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "posting_policy" (
    "organization_id" TEXT NOT NULL,
    "require_four_eyes_on_journals" BOOLEAN NOT NULL DEFAULT true,
    "draft_journals_block_period_close" BOOLEAN NOT NULL DEFAULT true,
    "enforce_control_account_at_db" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posting_policy_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "dimension_policy" (
    "organization_id" TEXT NOT NULL,
    "project_dimension_default" "DimensionRequirement" NOT NULL DEFAULT 'OPTIONAL',
    "department_dimension_default" "DimensionRequirement" NOT NULL DEFAULT 'OPTIONAL',
    "cost_center_dimension_default" "DimensionRequirement" NOT NULL DEFAULT 'OPTIONAL',
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dimension_policy_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "banking_policy" (
    "organization_id" TEXT NOT NULL,
    "require_bank_account_for_receipts" BOOLEAN NOT NULL DEFAULT true,
    "require_bank_account_for_payments" BOOLEAN NOT NULL DEFAULT true,
    "require_bank_review_before_close" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banking_policy_pkey" PRIMARY KEY ("organization_id")
);

-- CreateIndex
CREATE INDEX "departments_organization_id_status_idx" ON "departments"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organization_id_code_key" ON "departments"("organization_id", "code");

-- CreateIndex
CREATE INDEX "department_versions_department_id_effective_from_idx" ON "department_versions"("department_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "department_versions_department_id_version_number_key" ON "department_versions"("department_id", "version_number");

-- CreateIndex
CREATE INDEX "cost_centers_organization_id_department_id_status_idx" ON "cost_centers"("organization_id", "department_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_organization_id_code_key" ON "cost_centers"("organization_id", "code");

-- CreateIndex
CREATE INDEX "cost_center_versions_cost_center_id_effective_from_idx" ON "cost_center_versions"("cost_center_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "cost_center_versions_cost_center_id_version_number_key" ON "cost_center_versions"("cost_center_id", "version_number");

-- CreateIndex
CREATE INDEX "accounts_organization_id_status_idx" ON "accounts"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_organization_id_code_key" ON "accounts"("organization_id", "code");

-- CreateIndex
CREATE INDEX "account_versions_account_id_effective_from_idx" ON "account_versions"("account_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "account_versions_account_id_version_number_key" ON "account_versions"("account_id", "version_number");

-- CreateIndex
CREATE INDEX "fiscal_years_organization_id_status_idx" ON "fiscal_years"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_organization_id_name_key" ON "fiscal_years"("organization_id", "name");

-- CreateIndex
CREATE INDEX "accounting_periods_organization_id_status_idx" ON "accounting_periods"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_fiscal_year_id_period_number_key" ON "accounting_periods"("fiscal_year_id", "period_number");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_groups_organization_id_name_key" ON "treasury_groups"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_gl_account_id_key" ON "bank_accounts"("gl_account_id");

-- CreateIndex
CREATE INDEX "bank_accounts_organization_id_status_idx" ON "bank_accounts"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_organization_id_account_number_key" ON "bank_accounts"("organization_id", "account_number");

-- CreateIndex
CREATE INDEX "tax_codes_organization_id_status_idx" ON "tax_codes"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tax_codes_organization_id_code_key" ON "tax_codes"("organization_id", "code");

-- CreateIndex
CREATE INDEX "suppliers_organization_id_status_idx" ON "suppliers"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organization_id_code_key" ON "suppliers"("organization_id", "code");

-- CreateIndex
CREATE INDEX "supplier_contacts_supplier_id_idx" ON "supplier_contacts"("supplier_id");

-- CreateIndex
CREATE INDEX "posting_profiles_organization_id_status_idx" ON "posting_profiles"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "posting_profiles_organization_id_code_key" ON "posting_profiles"("organization_id", "code");

-- CreateIndex
CREATE INDEX "posting_profile_versions_posting_profile_id_effective_from_idx" ON "posting_profile_versions"("posting_profile_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "posting_profile_versions_posting_profile_id_version_number_key" ON "posting_profile_versions"("posting_profile_id", "version_number");

-- CreateIndex
CREATE INDEX "posting_rule_versions_organization_id_event_type_status_idx" ON "posting_rule_versions"("organization_id", "event_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "posting_rule_versions_organization_id_event_type_version_key" ON "posting_rule_versions"("organization_id", "event_type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "posting_rule_line_templates_posting_rule_version_id_line_nu_key" ON "posting_rule_line_templates"("posting_rule_version_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "document_number_sequences_organization_id_document_type_jou_key" ON "document_number_sequences"("organization_id", "document_type", "journal_category");

-- CreateIndex
CREATE UNIQUE INDEX "client_invoices_source_ipc_id_key" ON "client_invoices"("source_ipc_id");

-- CreateIndex
CREATE INDEX "client_invoices_organization_id_client_id_posting_status_idx" ON "client_invoices"("organization_id", "client_id", "posting_status");

-- CreateIndex
CREATE INDEX "client_invoices_organization_id_document_status_idx" ON "client_invoices"("organization_id", "document_status");

-- CreateIndex
CREATE UNIQUE INDEX "client_invoices_organization_id_invoice_number_key" ON "client_invoices"("organization_id", "invoice_number");

-- CreateIndex
CREATE INDEX "client_receipt_allocations_payment_receipt_id_idx" ON "client_receipt_allocations"("payment_receipt_id");

-- CreateIndex
CREATE INDEX "client_receipt_allocations_client_invoice_id_idx" ON "client_receipt_allocations"("client_invoice_id");

-- CreateIndex
CREATE INDEX "supplier_bills_organization_id_posting_status_idx" ON "supplier_bills"("organization_id", "posting_status");

-- CreateIndex
CREATE INDEX "supplier_bills_supplier_id_idx" ON "supplier_bills"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bills_organization_id_supplier_id_supplier_invoice_key" ON "supplier_bills"("organization_id", "supplier_id", "supplier_invoice_number_norm");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bills_organization_id_bill_number_key" ON "supplier_bills"("organization_id", "bill_number");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_bill_lines_supplier_bill_id_line_number_key" ON "supplier_bill_lines"("supplier_bill_id", "line_number");

-- CreateIndex
CREATE INDEX "supplier_payments_organization_id_posting_status_idx" ON "supplier_payments"("organization_id", "posting_status");

-- CreateIndex
CREATE INDEX "supplier_payments_supplier_id_idx" ON "supplier_payments"("supplier_id");

-- CreateIndex
CREATE INDEX "supplier_payment_allocations_supplier_payment_id_idx" ON "supplier_payment_allocations"("supplier_payment_id");

-- CreateIndex
CREATE INDEX "supplier_payment_allocations_supplier_bill_id_idx" ON "supplier_payment_allocations"("supplier_bill_id");

-- CreateIndex
CREATE INDEX "journal_entries_organization_id_accounting_date_idx" ON "journal_entries"("organization_id", "accounting_date");

-- CreateIndex
CREATE INDEX "journal_entries_organization_id_status_idx" ON "journal_entries"("organization_id", "status");

-- CreateIndex
CREATE INDEX "journal_entries_accounting_period_id_idx" ON "journal_entries"("accounting_period_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_organization_id_source_document_type_source_key" ON "journal_entries"("organization_id", "source_document_type", "source_document_id", "accounting_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_organization_id_journal_number_key" ON "journal_entries"("organization_id", "journal_number");

-- CreateIndex
CREATE INDEX "journal_lines_account_id_created_at_idx" ON "journal_lines"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "journal_lines_journal_entry_id_idx" ON "journal_lines"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_journal_entry_id_line_number_key" ON "journal_lines"("journal_entry_id", "line_number");

-- CreateIndex
CREATE INDEX "journal_entry_attachments_journal_entry_id_idx" ON "journal_entry_attachments"("journal_entry_id");

-- CreateIndex
CREATE INDEX "period_account_balances_organization_id_accounting_period_i_idx" ON "period_account_balances"("organization_id", "accounting_period_id", "account_id");

-- CreateIndex
CREATE INDEX "period_account_balances_accounting_period_id_status_idx" ON "period_account_balances"("accounting_period_id", "status");

-- CreateIndex
CREATE INDEX "subledger_control_reconciliations_organization_id_accountin_idx" ON "subledger_control_reconciliations"("organization_id", "accounting_period_id");

-- CreateIndex
CREATE INDEX "posting_attempts_organization_id_source_document_type_sourc_idx" ON "posting_attempts"("organization_id", "source_document_type", "source_document_id");

-- CreateIndex
CREATE INDEX "posting_attempts_correlation_id_idx" ON "posting_attempts"("correlation_id");

-- CreateIndex
CREATE INDEX "accounting_migration_batches_organization_id_status_idx" ON "accounting_migration_batches"("organization_id", "status");

-- CreateIndex
CREATE INDEX "payment_receipt_migration_exceptions_organization_id_status_idx" ON "payment_receipt_migration_exceptions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "payment_receipts_organization_id_posting_status_idx" ON "payment_receipts"("organization_id", "posting_status");

-- RenameForeignKey
ALTER TABLE "interim_payment_application_deductions" RENAME CONSTRAINT "ipa_deductions_application_id_fkey" TO "interim_payment_application_deductions_application_id_fkey";

-- RenameForeignKey
ALTER TABLE "interim_payment_application_items" RENAME CONSTRAINT "ipa_items_application_id_fkey" TO "interim_payment_application_items_application_id_fkey";

-- RenameForeignKey
ALTER TABLE "interim_payment_applications" RENAME CONSTRAINT "ipa_contract_id_fkey" TO "interim_payment_applications_contract_id_fkey";

-- RenameForeignKey
ALTER TABLE "interim_payment_applications" RENAME CONSTRAINT "ipa_organization_id_fkey" TO "interim_payment_applications_organization_id_fkey";

-- RenameForeignKey
ALTER TABLE "interim_payment_certificate_deductions" RENAME CONSTRAINT "ipc_deductions_certificate_id_fkey" TO "interim_payment_certificate_deductions_certificate_id_fkey";

-- RenameForeignKey
ALTER TABLE "interim_payment_certificate_items" RENAME CONSTRAINT "ipc_items_application_item_id_fkey" TO "interim_payment_certificate_items_application_item_id_fkey";

-- RenameForeignKey
ALTER TABLE "interim_payment_certificate_items" RENAME CONSTRAINT "ipc_items_certificate_id_fkey" TO "interim_payment_certificate_items_certificate_id_fkey";

-- RenameForeignKey
ALTER TABLE "interim_payment_certificates" RENAME CONSTRAINT "ipc_application_id_fkey" TO "interim_payment_certificates_application_id_fkey";

-- RenameForeignKey
ALTER TABLE "interim_payment_certificates" RENAME CONSTRAINT "ipc_organization_id_fkey" TO "interim_payment_certificates_organization_id_fkey";

-- RenameForeignKey
ALTER TABLE "interim_payment_certificates" RENAME CONSTRAINT "ipc_superseded_by_id_fkey" TO "interim_payment_certificates_superseded_by_id_fkey";

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_versions" ADD CONSTRAINT "department_versions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_versions" ADD CONSTRAINT "department_versions_parent_department_id_fkey" FOREIGN KEY ("parent_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_center_versions" ADD CONSTRAINT "cost_center_versions_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_versions" ADD CONSTRAINT "account_versions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_versions" ADD CONSTRAINT "account_versions_parent_account_id_fkey" FOREIGN KEY ("parent_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_groups" ADD CONSTRAINT "treasury_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_treasury_group_id_fkey" FOREIGN KEY ("treasury_group_id") REFERENCES "treasury_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_contacts" ADD CONSTRAINT "supplier_contacts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_profiles" ADD CONSTRAINT "posting_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_profile_versions" ADD CONSTRAINT "posting_profile_versions_posting_profile_id_fkey" FOREIGN KEY ("posting_profile_id") REFERENCES "posting_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_rule_line_templates" ADD CONSTRAINT "posting_rule_line_templates_posting_rule_version_id_fkey" FOREIGN KEY ("posting_rule_version_id") REFERENCES "posting_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_rule_line_templates" ADD CONSTRAINT "posting_rule_line_templates_posting_profile_id_fkey" FOREIGN KEY ("posting_profile_id") REFERENCES "posting_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_source_ipc_id_fkey" FOREIGN KEY ("source_ipc_id") REFERENCES "interim_payment_certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_receipt_allocations" ADD CONSTRAINT "client_receipt_allocations_payment_receipt_id_fkey" FOREIGN KEY ("payment_receipt_id") REFERENCES "payment_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_receipt_allocations" ADD CONSTRAINT "client_receipt_allocations_client_invoice_id_fkey" FOREIGN KEY ("client_invoice_id") REFERENCES "client_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_supplier_bill_id_fkey" FOREIGN KEY ("supplier_bill_id") REFERENCES "supplier_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_supplier_payment_id_fkey" FOREIGN KEY ("supplier_payment_id") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_supplier_bill_id_fkey" FOREIGN KEY ("supplier_bill_id") REFERENCES "supplier_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_accounting_period_id_fkey" FOREIGN KEY ("accounting_period_id") REFERENCES "accounting_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_of_journal_entry_id_fkey" FOREIGN KEY ("reversal_of_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_replaced_by_journal_entry_id_fkey" FOREIGN KEY ("replaced_by_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_version_id_fkey" FOREIGN KEY ("account_version_id") REFERENCES "account_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_posting_profile_version_id_fkey" FOREIGN KEY ("posting_profile_version_id") REFERENCES "posting_profile_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry_attachments" ADD CONSTRAINT "journal_entry_attachments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_account_balances" ADD CONSTRAINT "period_account_balances_accounting_period_id_fkey" FOREIGN KEY ("accounting_period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ipa_items_unique_boq_per_application" RENAME TO "interim_payment_application_items_application_id_boq_node_i_key";

-- RenameIndex
ALTER INDEX "ipc_items_unique_per_cert_app_item" RENAME TO "interim_payment_certificate_items_certificate_id_applicatio_key";

-- RenameIndex
ALTER INDEX "ipc_unique_number_per_application" RENAME TO "interim_payment_certificates_application_id_certificate_num_key";

-- RenameIndex
ALTER INDEX "workflow_trigger_bindings_org_kind_entity_tostate_idx" RENAME TO "workflow_trigger_bindings_organization_id_trigger_kind_enti_idx";
