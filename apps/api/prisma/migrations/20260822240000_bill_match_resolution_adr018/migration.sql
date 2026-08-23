-- ADR-018 Phase 2 — structured exception reasons + resolution (CONST-MATCH-007/008/009/014).

-- New terminal DISPUTED status (supplier invoice error — never posts).
ALTER TYPE "BillMatchStatus" ADD VALUE 'DISPUTED';

-- Structured reason + resolution-path enums.
CREATE TYPE "MatchExceptionReason" AS ENUM ('ROUNDING_VARIANCE', 'SUPPLIER_INVOICE_ERROR', 'AGREED_PRICE_CHANGE', 'FREIGHT_OR_ADDITIONAL_CHARGE', 'RECEIPT_CORRECTION', 'PO_QUANTITY_CHANGE', 'OTHER');
CREATE TYPE "MatchResolutionAction" AS ENUM ('APPROVE', 'DISPUTE', 'REQUIRE_PO_REVISION', 'REQUIRE_RECEIPT_CORRECTION');

-- Resolution recorded on the match header (resolver + time reuse approved_by/approved_at).
ALTER TABLE "supplier_bill_matches" ADD COLUMN "resolution_reason" "MatchExceptionReason";
ALTER TABLE "supplier_bill_matches" ADD COLUMN "resolution_action" "MatchResolutionAction";
ALTER TABLE "supplier_bill_matches" ADD COLUMN "resolution_notes" TEXT;
