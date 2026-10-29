-- CreateEnum
CREATE TYPE "BankStatementStatus" AS ENUM ('OPEN', 'RECONCILED');

-- CreateEnum
CREATE TYPE "StatementMatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'POSTED');

-- AlterEnum
ALTER TYPE "SourceDocType" ADD VALUE 'BANK_STATEMENT';

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "statement_date" DATE NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL,
    "opening_balance" DECIMAL(18,2) NOT NULL,
    "closing_balance" DECIMAL(18,2) NOT NULL,
    "file_name" TEXT,
    "status" "BankStatementStatus" NOT NULL DEFAULT 'OPEN',
    "reconciled_at" TIMESTAMP(3),
    "reconciled_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "transaction_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "match_status" "StatementMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matched_journal_line_id" TEXT,
    "adjustment_journal_entry_id" TEXT,
    "matched_at" TIMESTAMP(3),
    "matched_by" TEXT,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_statements_organization_id_bank_account_id_statement_d_idx" ON "bank_statements"("organization_id", "bank_account_id", "statement_date");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_matched_journal_line_id_key" ON "bank_statement_lines"("matched_journal_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_statement_id_line_number_key" ON "bank_statement_lines"("statement_id", "line_number");

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_matched_journal_line_id_fkey" FOREIGN KEY ("matched_journal_line_id") REFERENCES "journal_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

