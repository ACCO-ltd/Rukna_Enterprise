-- AP-5 — enum values in their own migration (PostgreSQL will not use a value in the transaction that adds it).
ALTER TYPE "DocumentType" ADD VALUE 'SUPPLIER_REFUND';
ALTER TYPE "SourceDocType" ADD VALUE 'SUPPLIER_REFUND';
