/**
 * ─── PO-backed bill: the "System finds …" derivation (Slice ④, D6) ───────────────
 *
 * When a bill is raised against a purchase order, the owner's flow shows a line confirming
 * what the system resolved before any line is entered:
 *
 *   System finds:  PO-0042 · GR-0081 (185 accepted) · GR-0093 (100 accepted)
 *
 * There is no single endpoint for that line (A14 exposes create-with-PO and auto-match, not a
 * pre-flight summary), so it is composed here from two reads the screens already make:
 *
 *  - `GET /procurement/purchase-orders/:id` — the ACTIVE revision and its lines, each carrying
 *    the cost-target the bill line will inherit (A3/D7).
 *  - `GET /procurement/goods-receipts?purchaseOrderId=…` — the receipts against the PO. Only
 *    POSTED receipts count toward the accepted quantity the 3-way match will bill against;
 *    a DRAFT or EXCEPTION_PENDING receipt has not moved the commitment ledger and is excluded.
 *
 * Nothing here calls the API or formats money — it derives plain data the component renders,
 * and it is pure so the "System finds" and the inherited-line logic are unit-testable without
 * a DOM. Quantities are passed through as the decimal strings the API sends.
 */

import type { GoodsReceipt, PurchaseOrder, PurchaseOrderLine, PurchaseOrderRevision } from './types';

/** The ACTIVE revision of a PO, or null when none is (the PO is not billable). */
export function activeRevision(po: PurchaseOrder | undefined): PurchaseOrderRevision | null {
  if (!po) return null;
  return po.revisions.find((r) => r.status === 'ACTIVE') ?? null;
}

/** One posted goods receipt, reduced to what the "System finds" line names. */
export interface PostedReceiptSummary {
  id: string;
  grnNumber: string;
  /** Total accepted quantity across the receipt's lines, as a number for display/sum. */
  acceptedQuantity: number;
}

/** The resolved PO context behind a PO-backed bill, as the "System finds" line renders it. */
export interface SystemFindsSummary {
  poNumber: string;
  /** The ACTIVE revision's lines — the source of the inherited bill-line drafts. */
  poLines: PurchaseOrderLine[];
  /** POSTED receipts only, newest first, each with its accepted-quantity total. */
  postedReceipts: PostedReceiptSummary[];
  /** True when the PO has an ACTIVE revision but no POSTED receipt — a two-way (PO-only) match. */
  noReceipts: boolean;
}

function sumAccepted(receipt: GoodsReceipt): number {
  return receipt.lines.reduce((total, line) => {
    const accepted = Number(line.acceptedQuantity);
    return total + (Number.isFinite(accepted) ? accepted : 0);
  }, 0);
}

/**
 * Compose the "System finds" summary from a resolved PO and its receipts.
 *
 * Returns null when the PO has no ACTIVE revision — the create form treats that as "this PO is
 * not billable" and does not show a summary, matching the server which would reject the create.
 */
export function systemFinds(
  po: PurchaseOrder | undefined,
  receipts: readonly GoodsReceipt[] | undefined,
): SystemFindsSummary | null {
  const revision = activeRevision(po);
  if (!po || !revision) return null;

  const postedReceipts = (receipts ?? [])
    .filter((r) => r.status === 'POSTED')
    .map((r) => ({ id: r.id, grnNumber: r.grnNumber, acceptedQuantity: sumAccepted(r) }));

  return {
    poNumber: po.poNumber,
    poLines: revision.lines ?? [],
    postedReceipts,
    noReceipts: postedReceipts.length === 0,
  };
}

/**
 * The label a bill line inherits from its PO line's cost-target (A3/D7, no. 148).
 *
 * A project-cost PO line carries both `project` and `boqNode` with their codes embedded, so
 * the chip can name them: "WBR-26-0065 · 03.10 Concrete". An org/overhead line carries neither
 * and inherits no target — the caller passes neither prop and no chip renders.
 */
export function poLineCostTargetLabel(line: PurchaseOrderLine): string | null {
  if (!line.project || !line.boqNode) return null;
  return `${line.project.code} · ${line.boqNode.code} ${line.boqNode.description}`;
}
