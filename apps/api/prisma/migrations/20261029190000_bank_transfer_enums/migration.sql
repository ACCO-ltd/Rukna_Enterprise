-- B-2 — enum values in their own migration (PostgreSQL will not use a value in the transaction that adds it).
ALTER TYPE "DocumentType" ADD VALUE 'BANK_TRANSFER';
ALTER TYPE "SourceDocType" ADD VALUE 'BANK_TRANSFER';
