-- Phase 3: InterimPaymentApplication, InterimPaymentCertificate, and Finance stubs

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE "IpaStatus" AS ENUM (
  'DRAFT',
  'PENDING_INTERNAL_APPROVAL',
  'RETURNED_FOR_REVISION',
  'APPROVED_FOR_SUBMISSION',
  'SUBMITTED',
  'CANCELLED'
);

CREATE TYPE "IpcStatus" AS ENUM (
  'CERTIFIED',
  'PARTIALLY_CERTIFIED',
  'REJECTED'
);

-- ─── interim_payment_applications ────────────────────────────────────────────

CREATE TABLE "interim_payment_applications" (
  "id"                    TEXT         NOT NULL,
  "contract_id"           TEXT         NOT NULL,
  "organization_id"       TEXT         NOT NULL,
  "application_number"    INTEGER,
  "application_ref"       TEXT,
  "status"                "IpaStatus"  NOT NULL DEFAULT 'DRAFT',
  "period_from"           DATE,
  "period_to"             DATE,
  "submitted_at"          TIMESTAMP(3),
  "submitted_by"          TEXT,
  "exchange_rate_currency" VARCHAR(3),
  "exchange_rate_base"    VARCHAR(3),
  "exchange_rate_value"   DECIMAL(18,6),
  "exchange_rate_date"    DATE,
  "notes"                 TEXT,
  "created_by"            TEXT         NOT NULL,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "interim_payment_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "interim_payment_applications_contract_id_application_number_key"
    UNIQUE ("contract_id", "application_number")
);

CREATE INDEX "interim_payment_applications_contract_id_status_idx"
  ON "interim_payment_applications" ("contract_id", "status");
CREATE INDEX "interim_payment_applications_organization_id_idx"
  ON "interim_payment_applications" ("organization_id");

ALTER TABLE "interim_payment_applications" ADD CONSTRAINT "ipa_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "interim_payment_applications" ADD CONSTRAINT "ipa_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── interim_payment_application_items ───────────────────────────────────────

CREATE TABLE "interim_payment_application_items" (
  "id"                          TEXT          NOT NULL,
  "application_id"              TEXT          NOT NULL,
  "boq_node_id"                 TEXT          NOT NULL,
  "measurement_method_snapshot" "MeasurementMethod" NOT NULL,
  "unit_rate_snapshot"          DECIMAL(18,2) NOT NULL,
  "currency_snapshot"           VARCHAR(3)    NOT NULL,
  "cumulative_claimed"          DECIMAL(18,3) NOT NULL,
  "previous_effective_certified" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "period_quantity"             DECIMAL(18,3) NOT NULL,
  "period_amount"               DECIMAL(18,2) NOT NULL,

  CONSTRAINT "interim_payment_application_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ipa_items_unique_boq_per_application"
    UNIQUE ("application_id", "boq_node_id")
);

CREATE INDEX "interim_payment_application_items_application_id_idx"
  ON "interim_payment_application_items" ("application_id");

ALTER TABLE "interim_payment_application_items" ADD CONSTRAINT "ipa_items_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "interim_payment_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── interim_payment_application_deductions ───────────────────────────────────

CREATE TABLE "interim_payment_application_deductions" (
  "id"             TEXT          NOT NULL,
  "application_id" TEXT          NOT NULL,
  "deduction_type" TEXT          NOT NULL,
  "source_term_id" TEXT,
  "rate"           DECIMAL(5,4),
  "basis"          DECIMAL(18,2) NOT NULL,
  "amount"         DECIMAL(18,2) NOT NULL,

  CONSTRAINT "interim_payment_application_deductions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "interim_payment_application_deductions_application_id_idx"
  ON "interim_payment_application_deductions" ("application_id");

ALTER TABLE "interim_payment_application_deductions" ADD CONSTRAINT "ipa_deductions_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "interim_payment_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── ipa_attachments ──────────────────────────────────────────────────────────

CREATE TABLE "ipa_attachments" (
  "id"               TEXT         NOT NULL,
  "application_id"   TEXT         NOT NULL,
  "platform_file_id" TEXT         NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"       TEXT         NOT NULL,

  CONSTRAINT "ipa_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ipa_attachments_application_id_idx" ON "ipa_attachments" ("application_id");

ALTER TABLE "ipa_attachments" ADD CONSTRAINT "ipa_attachments_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "interim_payment_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── interim_payment_certificates ────────────────────────────────────────────

CREATE TABLE "interim_payment_certificates" (
  "id"                   TEXT          NOT NULL,
  "application_id"       TEXT          NOT NULL,
  "organization_id"      TEXT          NOT NULL,
  "certificate_number"   INTEGER       NOT NULL,
  "certificate_ref"      TEXT,
  "status"               "IpcStatus"   NOT NULL,
  "is_effective"         BOOLEAN       NOT NULL DEFAULT false,
  "effective_at"         TIMESTAMP(3),
  "superseded_at"        TIMESTAMP(3),
  "superseded_by_id"     TEXT,
  "supersession_reason"  TEXT,
  "certified_total"      DECIMAL(18,2) NOT NULL,
  "currency"             VARCHAR(3)    NOT NULL,
  "exchange_rate_currency" VARCHAR(3),
  "exchange_rate_base"   VARCHAR(3),
  "exchange_rate_value"  DECIMAL(18,6),
  "exchange_rate_date"   DATE,
  "issued_at"            TIMESTAMP(3),
  "issued_by"            TEXT,
  "notes"                TEXT,
  "created_by"           TEXT          NOT NULL,
  "created_at"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "interim_payment_certificates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ipc_unique_number_per_application"
    UNIQUE ("application_id", "certificate_number")
);

CREATE INDEX "interim_payment_certificates_organization_id_status_idx"
  ON "interim_payment_certificates" ("organization_id", "status");
CREATE INDEX "interim_payment_certificates_application_id_is_effective_idx"
  ON "interim_payment_certificates" ("application_id", "is_effective");

-- Partial unique index: at most one effective certificate per application.
CREATE UNIQUE INDEX "ipc_one_effective_per_application"
  ON "interim_payment_certificates" ("application_id")
  WHERE "is_effective" = true;

ALTER TABLE "interim_payment_certificates" ADD CONSTRAINT "ipc_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "interim_payment_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "interim_payment_certificates" ADD CONSTRAINT "ipc_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "interim_payment_certificates" ADD CONSTRAINT "ipc_superseded_by_id_fkey"
  FOREIGN KEY ("superseded_by_id") REFERENCES "interim_payment_certificates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── interim_payment_certificate_items ───────────────────────────────────────

CREATE TABLE "interim_payment_certificate_items" (
  "id"                  TEXT          NOT NULL,
  "certificate_id"      TEXT          NOT NULL,
  "application_item_id" TEXT          NOT NULL,
  "certified_quantity"  DECIMAL(18,3) NOT NULL,
  "certified_amount"    DECIMAL(18,2) NOT NULL,
  "variance_quantity"   DECIMAL(18,3) NOT NULL,
  "variance_reason"     TEXT,

  CONSTRAINT "interim_payment_certificate_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ipc_items_unique_per_cert_app_item"
    UNIQUE ("certificate_id", "application_item_id")
);

CREATE INDEX "interim_payment_certificate_items_certificate_id_idx"
  ON "interim_payment_certificate_items" ("certificate_id");

ALTER TABLE "interim_payment_certificate_items" ADD CONSTRAINT "ipc_items_certificate_id_fkey"
  FOREIGN KEY ("certificate_id") REFERENCES "interim_payment_certificates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "interim_payment_certificate_items" ADD CONSTRAINT "ipc_items_application_item_id_fkey"
  FOREIGN KEY ("application_item_id") REFERENCES "interim_payment_application_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── interim_payment_certificate_deductions ───────────────────────────────────

CREATE TABLE "interim_payment_certificate_deductions" (
  "id"              TEXT          NOT NULL,
  "certificate_id"  TEXT          NOT NULL,
  "deduction_type"  TEXT          NOT NULL,
  "source_term_id"  TEXT,
  "rate"            DECIMAL(5,4),
  "basis"           DECIMAL(18,2) NOT NULL,
  "amount"          DECIMAL(18,2) NOT NULL,

  CONSTRAINT "interim_payment_certificate_deductions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "interim_payment_certificate_deductions_certificate_id_idx"
  ON "interim_payment_certificate_deductions" ("certificate_id");

ALTER TABLE "interim_payment_certificate_deductions" ADD CONSTRAINT "ipc_deductions_certificate_id_fkey"
  FOREIGN KEY ("certificate_id") REFERENCES "interim_payment_certificates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── ipc_attachments ──────────────────────────────────────────────────────────

CREATE TABLE "ipc_attachments" (
  "id"               TEXT         NOT NULL,
  "certificate_id"   TEXT         NOT NULL,
  "platform_file_id" TEXT         NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"       TEXT         NOT NULL,

  CONSTRAINT "ipc_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ipc_attachments_certificate_id_idx" ON "ipc_attachments" ("certificate_id");

ALTER TABLE "ipc_attachments" ADD CONSTRAINT "ipc_attachments_certificate_id_fkey"
  FOREIGN KEY ("certificate_id") REFERENCES "interim_payment_certificates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Finance stubs (Phase 4 — created now so IPC FK is valid) ────────────────

CREATE TABLE "payment_receipts" (
  "id"              TEXT          NOT NULL,
  "organization_id" TEXT          NOT NULL,
  "client_id"       TEXT          NOT NULL,
  "receipt_date"    DATE          NOT NULL,
  "amount"          DECIMAL(18,2) NOT NULL,
  "currency"        VARCHAR(3)    NOT NULL,
  "exchange_rate"   DECIMAL(18,6),
  "reference"       TEXT,
  "notes"           TEXT,
  "created_by"      TEXT          NOT NULL,
  "created_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_receipts_organization_id_client_id_idx"
  ON "payment_receipts" ("organization_id", "client_id");
CREATE INDEX "payment_receipts_receipt_date_idx"
  ON "payment_receipts" ("receipt_date");

ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "receipt_allocations" (
  "id"               TEXT          NOT NULL,
  "receipt_id"       TEXT          NOT NULL,
  "certificate_id"   TEXT          NOT NULL,
  "allocated_amount" DECIMAL(18,2) NOT NULL,
  "allocated_at"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "allocated_by"     TEXT          NOT NULL,

  CONSTRAINT "receipt_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "receipt_allocations_receipt_id_idx" ON "receipt_allocations" ("receipt_id");
CREATE INDEX "receipt_allocations_certificate_id_idx" ON "receipt_allocations" ("certificate_id");

ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_receipt_id_fkey"
  FOREIGN KEY ("receipt_id") REFERENCES "payment_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_certificate_id_fkey"
  FOREIGN KEY ("certificate_id") REFERENCES "interim_payment_certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
