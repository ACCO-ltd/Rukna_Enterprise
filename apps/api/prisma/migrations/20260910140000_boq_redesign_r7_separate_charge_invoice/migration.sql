-- ADR-029 (BOQ workspace redesign) R7 — separate-charge one-off billing (R-4).
--
-- A separate charge (commercialTreatment = SEPARATE_CHARGE) is a real BOQ leaf billed as a one-off
-- ClientInvoice OUTSIDE the milestone schedule. Such an invoice carries neither an IPC nor a payment
-- installment, so without a tag it would be indistinguishable from a migration-loaded (NONE) invoice
-- and from a future VO invoice. This adds the source tag: a nullable FK to the SEPARATE_CHARGE node.
--
-- PURELY ADDITIVE and backward-compatible: one new nullable column + its unique index + a SetNull FK.
-- It is NULL for every existing invoice (installment / IPC / migration-loaded), so there is no data
-- flip and no backfill — the R1 contract-phase remains deferred. The unique index makes separate-charge
-- billing idempotent (one invoice per node), exactly as source_installment_id does for installments.

-- AlterTable — the SEPARATE_CHARGE BOQ leaf a one-off invoice bills (source tag; null for all others)
ALTER TABLE "client_invoices" ADD COLUMN     "source_boq_node_id" TEXT;

-- CreateIndex — one invoice per separate-charge node (idempotent billing), mirroring source_installment_id
CREATE UNIQUE INDEX "client_invoices_source_boq_node_id_key" ON "client_invoices"("source_boq_node_id");

-- AddForeignKey — SetNull: the invoice is the durable billing record and outlives the node (CONST-BOQ-003
-- deactivates, never deletes; this only ever fires under a full BOQ cascade, never orphaning the invoice).
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_source_boq_node_id_fkey" FOREIGN KEY ("source_boq_node_id") REFERENCES "boq_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
