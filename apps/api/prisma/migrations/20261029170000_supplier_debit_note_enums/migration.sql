-- AP-4 — enum values go in their own migration: PostgreSQL will not use a new enum value in the
-- same transaction that adds it.
ALTER TYPE "DocumentType" ADD VALUE 'SUPPLIER_DEBIT_NOTE';
ALTER TYPE "SourceDocType" ADD VALUE 'SUPPLIER_DEBIT_NOTE';
ALTER TYPE "CommitmentSourceDocType" ADD VALUE 'SUPPLIER_DEBIT_NOTE';
