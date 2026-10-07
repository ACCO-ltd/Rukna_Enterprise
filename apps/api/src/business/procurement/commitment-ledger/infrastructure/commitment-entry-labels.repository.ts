import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface LabelSource {
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceRevision: number | null;
  supplierId: string | null;
  purchaseOrderId: string | null;
  boqNodeId: string | null;
}

export interface EntryLabels {
  /** Human reference of the source document: "PO-00042 (Rev 2)", "GRN-00007", the bill number. */
  documentNumber: string | null;
  supplierName: string | null;
  boqNode: { id: string; code: string; name: string } | null;
}

const PO_TYPES = new Set(['PURCHASE_ORDER_REVISION', 'PO_CANCELLATION']);
const GRN_TYPES = new Set(['GOODS_RECEIPT', 'GRN_REVERSAL']);
const BILL_TYPES = new Set(['SUPPLIER_BILL', 'BILL_REVERSAL']);

/**
 * Batch-resolves the labels a commitment-ledger row needs to be read by a person — the source
 * document's number, the supplier's name and the BOQ node — in one query per kind (no N+1).
 * Org-scoped: every lookup filters on the caller's organization.
 */
@Injectable()
export class CommitmentEntryLabelsRepository {
  async resolve(prisma: TenantPrisma, organizationId: string, entries: LabelSource[]): Promise<EntryLabels[]> {
    const ids = (pred: (e: LabelSource) => boolean, pick: (e: LabelSource) => string | null) =>
      [...new Set(entries.filter(pred).map(pick).filter((v): v is string => Boolean(v)))];

    const poIds = ids(() => true, (e) => (PO_TYPES.has(e.sourceDocumentType) ? e.sourceDocumentId : e.purchaseOrderId));
    const grnIds = ids((e) => GRN_TYPES.has(e.sourceDocumentType), (e) => e.sourceDocumentId);
    const billIds = ids((e) => BILL_TYPES.has(e.sourceDocumentType), (e) => e.sourceDocumentId);
    const supplierIds = ids(() => true, (e) => e.supplierId);
    const nodeIds = ids(() => true, (e) => e.boqNodeId);

    const [pos, grns, bills, suppliers, nodes] = await Promise.all([
      poIds.length
        ? prisma.purchaseOrder.findMany({ where: { organizationId, id: { in: poIds } }, select: { id: true, poNumber: true } })
        : [],
      grnIds.length
        ? prisma.goodsReceiptNote.findMany({ where: { organizationId, id: { in: grnIds } }, select: { id: true, grnNumber: true } })
        : [],
      billIds.length
        ? prisma.supplierBill.findMany({
            where: { organizationId, id: { in: billIds } },
            select: { id: true, billNumber: true, supplierInvoiceNumber: true },
          })
        : [],
      supplierIds.length
        ? prisma.supplier.findMany({ where: { organizationId, id: { in: supplierIds } }, select: { id: true, name: true } })
        : [],
      nodeIds.length
        ? prisma.boqNode.findMany({
            where: { id: { in: nodeIds }, version: { boq: { organizationId } } },
            select: { id: true, code: true, description: true },
          })
        : [],
    ]);

    const poNumber = new Map<string, string>(pos.map((p) => [p.id, p.poNumber] as const));
    const grnNumber = new Map<string, string>(grns.map((g) => [g.id, g.grnNumber] as const));
    const billNumber = new Map<string, string>(
      bills.map((b) => [b.id, b.billNumber ?? b.supplierInvoiceNumber] as const),
    );
    const supplierName = new Map<string, string>(suppliers.map((s) => [s.id, s.name] as const));
    const node = new Map<string, { id: string; code: string; name: string }>(
      nodes.map((n) => [n.id, { id: n.id, code: n.code, name: n.description }] as const),
    );

    return entries.map((e) => {
      let documentNumber: string | null = null;
      if (PO_TYPES.has(e.sourceDocumentType)) {
        const n = poNumber.get(e.sourceDocumentId);
        documentNumber = n ? (e.sourceRevision !== null ? `${n} (Rev ${e.sourceRevision})` : n) : null;
      } else if (GRN_TYPES.has(e.sourceDocumentType)) {
        documentNumber = grnNumber.get(e.sourceDocumentId) ?? null;
      } else if (BILL_TYPES.has(e.sourceDocumentType)) {
        documentNumber = billNumber.get(e.sourceDocumentId) ?? null;
      }
      return {
        documentNumber,
        supplierName: e.supplierId ? (supplierName.get(e.supplierId) ?? null) : null,
        boqNode: e.boqNodeId ? (node.get(e.boqNodeId) ?? null) : null,
      };
    });
  }
}
