-- ADR-024 ACC-DEAD-001: drop the unused Sprint-3 migration scaffolding.
-- DropTable
DROP TABLE "accounting_migration_batches";

-- DropTable
DROP TABLE "payment_receipt_migration_exceptions";

-- DropEnum
DROP TYPE "ExceptionStatus";

-- DropEnum
DROP TYPE "MigrationStatus";
