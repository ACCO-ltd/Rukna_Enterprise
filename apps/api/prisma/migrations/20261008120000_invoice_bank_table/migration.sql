-- Invoice "Bank Account Details" table (owner request): the invoice settings become typed rows of
-- bank name + account number and a typed signatory name/title, no longer links to accounting bank
-- accounts or users. Existing settings carry over: the linked bank account becomes the first row,
-- the linked user's name becomes the signatory name (the title is kept).

ALTER TABLE "invoice_document_policy"
    ADD COLUMN "payment_accounts" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "signatory_name" VARCHAR(120);

UPDATE "invoice_document_policy" AS p
SET "payment_accounts" = jsonb_build_array(
        jsonb_build_object('bankName', b."bank_name", 'accountNumber', b."account_number"))
FROM "bank_accounts" AS b
WHERE b."id" = p."bank_account_id";

UPDATE "invoice_document_policy" AS p
SET "signatory_name" = NULLIF(LEFT(TRIM(u."first_name" || ' ' || u."last_name"), 120), '')
FROM "users" AS u
WHERE u."id" = p."signatory_user_id";

ALTER TABLE "invoice_document_policy"
    DROP COLUMN "bank_account_id",
    DROP COLUMN "signatory_user_id";
