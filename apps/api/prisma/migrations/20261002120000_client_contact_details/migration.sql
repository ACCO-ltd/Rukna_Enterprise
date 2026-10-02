-- Clients redesign (2026-10-02, docs/design/clients-redesign-contract.md).
--
-- 1. Client master data: registration number, default payment terms, country + city, invoice email.
-- 2. Contacts: a WhatsApp number and a created_at (so "earliest contact" is answerable from now on).
-- 3. Exactly one primary contact per client, enforced by a PARTIAL unique index. Existing data is
--    repaired first: a client with several primaries keeps the earliest; a client with contacts but
--    no primary gets its earliest contact promoted. Contacts had no timestamp before this migration,
--    so "earliest" is the lowest id (cuid ids are time-ordered).
--
-- Existing phone values are left as stored; the API normalises them to E.164 when next edited.

-- AlterTable
ALTER TABLE "clients"
  ADD COLUMN "registration_number" VARCHAR(50),
  ADD COLUMN "payment_terms_days" INTEGER,
  ADD COLUMN "country_code" VARCHAR(2) NOT NULL DEFAULT 'SO',
  ADD COLUMN "city" VARCHAR(100),
  ADD COLUMN "invoice_email" VARCHAR(254);

-- AlterTable
ALTER TABLE "client_contacts"
  ADD COLUMN "whatsapp_phone" TEXT,
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Repair: several primaries -> keep the earliest.
UPDATE "client_contacts" AS c
SET "is_primary" = false
WHERE c."is_primary" = true
  AND EXISTS (
    SELECT 1 FROM "client_contacts" AS earlier
    WHERE earlier."client_id" = c."client_id"
      AND earlier."is_primary" = true
      AND earlier."id" < c."id"
  );

-- Repair: contacts but no primary -> the earliest contact becomes primary.
UPDATE "client_contacts" AS c
SET "is_primary" = true
WHERE c."id" IN (
  SELECT DISTINCT ON ("client_id") "id"
  FROM "client_contacts"
  WHERE "client_id" IN (
    SELECT "client_id" FROM "client_contacts"
    GROUP BY "client_id"
    HAVING bool_or("is_primary") = false
  )
  ORDER BY "client_id", "id"
);

-- One primary per client. Partial index: Prisma cannot model it, so it exists in SQL only (see the
-- comment on ClientContact.isPrimary in schema.prisma).
CREATE UNIQUE INDEX "client_contacts_one_primary_per_client"
  ON "client_contacts" ("client_id")
  WHERE "is_primary";
