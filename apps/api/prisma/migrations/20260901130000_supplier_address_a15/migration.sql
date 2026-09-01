-- A15 (D8): editable supplier master data. Suppliers gain a plain-text postal `address`
-- master field, mirroring `clients.address`. Pure master data (corrected via PATCH /suppliers/:id,
-- permission-gated + audited). Nullable and additive — existing rows keep NULL. This is master data
-- only: PurchaseOrder / SupplierBill reference the supplier by FK (supplier_id) and snapshot no
-- supplier fields, so editing this record never rewrites historical transactional facts on issued docs.
ALTER TABLE "suppliers" ADD COLUMN "address" TEXT;
