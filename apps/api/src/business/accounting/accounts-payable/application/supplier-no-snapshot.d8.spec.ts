import { Prisma } from '@prisma/client';

/**
 * A15 / D8 invariant guard (no DB needed — reads the generated Prisma DMMF).
 *
 * Editing supplier master data must affect FUTURE usage, not rewrite historical facts on
 * issued documents. That is only safe because issued POs and SupplierBills reference the
 * supplier by FK (`supplierId`) and snapshot NO supplier master fields onto themselves.
 * If someone later adds a `supplierName` / `supplierTaxNumber` / `supplierAddress` /
 * `supplierPaymentTerms` column to any of these documents, this test fails — forcing a
 * decision about whether PATCH /suppliers must leave that snapshot untouched.
 */

const SNAPSHOT_LOOKALIKES = /^supplier(name|taxnumber|tax|address|paymentterms|terms|currency|defaultcurrency)$/i;

function scalarFieldNames(modelName: string): string[] {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  if (!model) throw new Error(`Model ${modelName} not found in DMMF`);
  return model.fields.filter((f) => f.kind === 'scalar').map((f) => f.name);
}

describe('D8: issued documents do not snapshot supplier master fields', () => {
  it.each(['PurchaseOrder', 'PurchaseOrderRevision', 'SupplierBill', 'SupplierBillLine'])(
    '%s references the supplier by FK only (no snapshotted supplier master field)',
    (modelName) => {
      const fields = scalarFieldNames(modelName);
      const offenders = fields.filter((f) => SNAPSHOT_LOOKALIKES.test(f.replace(/_/g, '')));
      expect(offenders).toEqual([]);
    },
  );

  it('PurchaseOrder and SupplierBill still carry the supplierId FK', () => {
    expect(scalarFieldNames('PurchaseOrder')).toContain('supplierId');
    expect(scalarFieldNames('SupplierBill')).toContain('supplierId');
  });
});
