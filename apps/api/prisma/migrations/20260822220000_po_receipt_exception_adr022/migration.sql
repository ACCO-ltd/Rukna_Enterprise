-- ADR-022 CONST-DOA-004 — documented exception to PO_CREATOR_CANNOT_RECEIVE_GOODS. A PO creator
-- may receive goods against their own order only with independent supervisor verification AND CFO
-- approval; an APPROVED exception lets that receiver's GRN through the segregation-of-duties block.
CREATE TYPE "PoReceiptExceptionStatus" AS ENUM ('PENDING', 'SUPERVISOR_VERIFIED', 'APPROVED', 'REJECTED');

CREATE TABLE "po_receipt_exceptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "receiver_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PoReceiptExceptionStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" TEXT NOT NULL,
    "supervisor_user_id" TEXT,
    "supervisor_verified_at" TIMESTAMP(3),
    "cfo_user_id" TEXT,
    "cfo_approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "po_receipt_exceptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "po_receipt_exceptions_organization_id_purchase_order_id_rec_idx" ON "po_receipt_exceptions"("organization_id", "purchase_order_id", "receiver_user_id", "status");
ALTER TABLE "po_receipt_exceptions" ADD CONSTRAINT "po_receipt_exceptions_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
