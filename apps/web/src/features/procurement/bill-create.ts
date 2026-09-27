/**
 * ─── New supplier bill: line rules, previews and payloads (ADR-037) ─────────────
 *
 * One create page serves both kinds of bill, chosen up front:
 *
 *  - **Against a purchase order** — one line per line of the PO's ACTIVE revision, in order.
 *    The server matches bill lines to PO lines by position (or material), so lines are never
 *    added, removed or reordered here. Cost coding is inherited from the PO line at post time
 *    (D7) and is never keyed on the bill.
 *  - **Direct expense** — no PO; matching does not apply. Every line names its expense posting
 *    profile, and cost coding is keyed by hand: the bill's project (or an explicit "belongs to no
 *    project"), and for a project, the BOQ item or project cost category each line is for —
 *    the same three attributions `validateCostTarget` accepts on the server.
 *
 * Everything here is pure, so the rules are unit-tested without a DOM.
 *
 * ─── Money ──────────────────────────────────────────────────────────────────────
 *
 * Amounts are text, parsed to integer minor units (`parseMinorUnits` returns null on a bad
 * value — never 0, because a typo reading as a valid zero is how a bill posts for nothing), and
 * become JSON numbers only in the payload (`moneyToApi` / `quantityToApi`). A line's Amount is
 * `quantity × unit price` through `extendedAmountMinor`, the one place that scale change
 * happens. The server recomputes the bill's subtotal, VAT and total from the lines it receives;
 * the totals shown on the form are a preview of that.
 */

import { MONEY_SCALE, QUANTITY_SCALE, parseMinorUnits } from '@/lib/money';

import { poLineCostTargetLabel } from './bill-po-match';
import { buildCostTargetPayload, isCostTargetComplete, type CostTargetValue } from './components/po-cost-target-picker';
import { extendedAmountMinor, moneyToApi, quantityToApi } from './quantities';
import type {
  CreateSupplierBillLinePayload,
  CreateSupplierBillPayload,
  GoodsReceipt,
  PurchaseOrderLine,
  SupplierBill,
} from './types';

export type BillKind = 'po' | 'direct';

/** The Project select's value for "this bill belongs to no project" — overhead. */
export const NO_PROJECT = 'none';

// ─── Supplier invoice number ─────────────────────────────────────────────────────

/**
 * The server's duplicate key, exactly: trimmed, upper-cased, everything but A–Z and 0–9
 * stripped (`normalizeSupplierInvoiceNumber` in supplier-bill.repository.ts).
 */
export function normalizeInvoiceNumber(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * The supplier's existing bill that already holds this invoice number, or null. Every status
 * counts — the unique index covers drafts and reversed bills alike.
 */
export function findDuplicateBill(
  bills: readonly SupplierBill[],
  supplierId: string,
  invoiceNumber: string,
): SupplierBill | null {
  const norm = normalizeInvoiceNumber(invoiceNumber);
  if (!supplierId || !norm) return null;
  return (
    bills.find(
      (bill) =>
        bill.supplierId === supplierId && normalizeInvoiceNumber(bill.supplierInvoiceNumber) === norm,
    ) ?? null
  );
}

// ─── Dates ───────────────────────────────────────────────────────────────────────

/**
 * `YYYY-MM-DD` plus whole days, as `YYYY-MM-DD`. Calendar arithmetic in UTC, so a daylight-
 * saving change can never move the answer a day. Null for a date that does not parse.
 */
export function addDays(isoDate: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The due date the supplier's terms give, or null when there are no terms or no bill date. */
export function dueDateFromTerms(billDate: string, paymentTermsDays: number | null | undefined): string | null {
  if (!billDate || paymentTermsDays === null || paymentTermsDays === undefined) return null;
  return addDays(billDate, paymentTermsDays);
}

// ─── Lines ───────────────────────────────────────────────────────────────────────

/** A direct-expense line as typed. */
export interface DirectLineDraft {
  /** Stable React key — lines can be removed from the middle. */
  key: string;
  description: string;
  expenseProfileCode: string;
  quantity: string;
  unitPrice: string;
  vatAmount: string;
  /**
   * What a project line is spending on: `node:<boqNodeId>` or `category:<spendCategoryId>`.
   * Empty when the bill has no project, where it does not apply.
   */
  costLine: string;
}

let lineSeq = 0;

export function emptyDirectLine(): DirectLineDraft {
  lineSeq += 1;
  return {
    key: `line-${lineSeq}`,
    description: '',
    expenseProfileCode: '',
    quantity: '1',
    unitPrice: '',
    vatAmount: '',
    costLine: '',
  };
}

/** Quantity received against one PO line, across the PO's POSTED receipts. */
export interface ReceivedOnLine {
  /** Accepted quantity, in quantity minor units (3dp). */
  acceptedMinor: number;
  /** The receipts it came from — "GR-0081", "GR-0081, GR-0093". */
  grnNumbers: string[];
}

/** A line of a PO-backed bill: seeded from one PO line, with only the billed figures editable. */
export interface PoLineDraft {
  poLineId: string;
  description: string;
  unit: string | null;
  /** Ordered quantity on the PO line, as the API sends it. */
  ordered: string;
  /** What has been received against it; null when the PO has no posted receipt at all. */
  received: ReceivedOnLine | null;
  quantity: string;
  unitPrice: string;
  vatAmount: string;
  expenseProfileCode: string;
  costTargetLabel: string | null;
}

/**
 * Accepted quantity per PO line across the POSTED receipts. A draft or exception-pending
 * receipt has not moved the commitment ledger and is not what the match compares against.
 */
export function receivedByPoLine(receipts: readonly GoodsReceipt[] | undefined): Map<string, ReceivedOnLine> {
  const byLine = new Map<string, ReceivedOnLine>();
  for (const receipt of receipts ?? []) {
    if (receipt.status !== 'POSTED') continue;
    for (const line of receipt.lines) {
      const accepted = parseMinorUnits(line.acceptedQuantity, QUANTITY_SCALE) ?? 0;
      const entry = byLine.get(line.purchaseOrderLineId) ?? { acceptedMinor: 0, grnNumbers: [] };
      entry.acceptedMinor += accepted;
      if (!entry.grnNumbers.includes(receipt.grnNumber)) entry.grnNumbers.push(receipt.grnNumber);
      byLine.set(line.purchaseOrderLineId, entry);
    }
  }
  return byLine;
}

/**
 * Seeds a bill line from a PO line — the ordinary case (the invoice bills the order) is a
 * confirm, not a re-key. `threeWay` is whether the PO has any posted receipt: when it does, a
 * line with nothing received reads as "received 0", not as "not applicable".
 */
export function seedPoLine(
  line: PurchaseOrderLine,
  received: Map<string, ReceivedOnLine>,
  threeWay: boolean,
): PoLineDraft {
  return {
    poLineId: line.id,
    description: line.description,
    unit: line.uom?.symbol ?? line.uom?.code ?? null,
    ordered: line.orderedQuantity,
    received: threeWay ? (received.get(line.id) ?? { acceptedMinor: 0, grnNumbers: [] }) : null,
    quantity: line.orderedQuantity,
    unitPrice: line.unitPrice,
    vatAmount: '',
    expenseProfileCode: '',
    costTargetLabel: poLineCostTargetLabel(line),
  };
}

/** `quantity × unit price` in money minor units, or null while either is not a number. */
export function lineAmountMinor(line: { quantity: string; unitPrice: string }): number | null {
  const qty = parseMinorUnits(line.quantity, QUANTITY_SCALE);
  const price = parseMinorUnits(line.unitPrice, MONEY_SCALE);
  if (qty === null || price === null) return null;
  return extendedAmountMinor(qty, price);
}

export interface BillTotalsMinor {
  subtotal: number;
  vat: number;
  total: number;
}

/** Subtotal (Σ amount), VAT and Total, in minor units. A line not yet complete counts as zero. */
export function billTotalsMinor(
  lines: readonly { quantity: string; unitPrice: string; vatAmount: string }[],
): BillTotalsMinor {
  let subtotal = 0;
  let vat = 0;
  for (const line of lines) {
    subtotal += lineAmountMinor(line) ?? 0;
    vat += parseMinorUnits(line.vatAmount, MONEY_SCALE) ?? 0;
  }
  return { subtotal, vat, total: subtotal + vat };
}

// ─── Line validation ─────────────────────────────────────────────────────────────

/** Keys under `procurement.bills.lineError` (and `create.errors.costLine`). */
export type LineErrorKey = 'description' | 'profile' | 'quantity' | 'unitPrice' | 'net' | 'vat' | 'costLine';

export type LineErrors = Partial<Record<'description' | 'profile' | 'quantity' | 'unitPrice' | 'vat' | 'costLine', LineErrorKey>>;

/**
 * The figures every line shares.
 *
 * - Quantity must be positive: on a PO bill it is what the three-way match compares, and on a
 *   direct bill a zero-quantity line bills nothing.
 * - VAT must be typed. `vatAmount` is `@IsNumber() @Min(0)` with no default, and "no VAT" and
 *   "VAT not entered yet" must not look the same on a document that posts to the ledger — an
 *   explicit 0 is the answer for a line with none.
 * - The amount must be computable: a figure so large its product overflows is refused rather
 *   than sent as a quietly wrong number.
 */
function figureErrors(line: { quantity: string; unitPrice: string; vatAmount: string }): LineErrors {
  const errors: LineErrors = {};
  const qty = parseMinorUnits(line.quantity, QUANTITY_SCALE);
  if (qty === null || qty <= 0) errors.quantity = 'quantity';

  const price = parseMinorUnits(line.unitPrice, MONEY_SCALE);
  if (price === null || price < 0) errors.unitPrice = 'unitPrice';
  else if (!errors.quantity && lineAmountMinor(line) === null) errors.unitPrice = 'net';

  const vat = parseMinorUnits(line.vatAmount, MONEY_SCALE);
  if (vat === null || vat < 0) errors.vat = 'vat';
  return errors;
}

/** Every problem on a PO-backed line, keyed by the column it belongs to. */
export function poLineErrors(line: PoLineDraft): LineErrors {
  const errors = figureErrors(line);
  if (!line.description.trim()) errors.description = 'description';
  if (!line.expenseProfileCode) errors.profile = 'profile';
  return errors;
}

/**
 * The cost target a direct line carries, from the bill's Project choice and the line's cost
 * line. `projectChoice` is `''` (not answered), `NO_PROJECT`, or a project id.
 */
export function directLineCostTarget(projectChoice: string, costLine: string): CostTargetValue {
  if (projectChoice === NO_PROJECT) {
    return { notChargeable: true, projectId: null, boqNodeId: null, spendCategoryId: null };
  }
  const projectId = projectChoice || null;
  const [kind, id] = costLine.split(':');
  return {
    notChargeable: false,
    projectId,
    boqNodeId: kind === 'node' && id ? id : null,
    spendCategoryId: kind === 'category' && id ? id : null,
  };
}

/**
 * Every problem on a direct-expense line. The cost line is only asked for once the bill names a
 * project: a project with no BOQ item or cost category is the unclassified bucket the server
 * refuses (PROJECT_WITHOUT_COST_TARGET).
 */
export function directLineErrors(line: DirectLineDraft, projectChoice: string): LineErrors {
  const errors = figureErrors(line);
  if (!line.description.trim()) errors.description = 'description';
  if (!line.expenseProfileCode) errors.profile = 'profile';
  if (projectChoice && projectChoice !== NO_PROJECT) {
    if (!isCostTargetComplete(directLineCostTarget(projectChoice, line.costLine))) {
      errors.costLine = 'costLine';
    }
  }
  return errors;
}

// ─── Over-billing (PO path) ──────────────────────────────────────────────────────

export type OverBilling =
  | { kind: 'received'; excessMinor: number; grnNumbers: string[] }
  | { kind: 'ordered'; excessMinor: number };

/**
 * Whether this line bills more than the match's reference quantity: what was received when the
 * PO has posted receipts (three-way), what was ordered when it has none (two-way). A preview
 * only — the server's match also counts earlier bills on the same line and any tolerance its
 * policy allows, so this says the exception is likely, not certain.
 */
export function overBilling(line: PoLineDraft): OverBilling | null {
  const billed = parseMinorUnits(line.quantity, QUANTITY_SCALE);
  if (billed === null || billed <= 0) return null;

  if (line.received) {
    const excess = billed - line.received.acceptedMinor;
    return excess > 0 ? { kind: 'received', excessMinor: excess, grnNumbers: line.received.grnNumbers } : null;
  }
  const ordered = parseMinorUnits(line.ordered, QUANTITY_SCALE) ?? 0;
  const excess = billed - ordered;
  return excess > 0 ? { kind: 'ordered', excessMinor: excess } : null;
}

// ─── Payloads ────────────────────────────────────────────────────────────────────

interface HeaderDraft {
  supplierId: string;
  invoiceNumber: string;
  billDate: string;
  dueDate: string;
}

function figures(line: { quantity: string; unitPrice: string; vatAmount: string }) {
  return {
    quantity: quantityToApi(parseMinorUnits(line.quantity, QUANTITY_SCALE) ?? 0),
    unitPrice: moneyToApi(parseMinorUnits(line.unitPrice, MONEY_SCALE) ?? 0),
    netAmount: moneyToApi(lineAmountMinor(line) ?? 0),
    vatAmount: moneyToApi(parseMinorUnits(line.vatAmount, MONEY_SCALE) ?? 0),
  };
}

/**
 * `POST /bills` for a PO-backed bill. No project and no cost coding: the bill inherits the PO
 * line's target at post time (D7), and sending one here would only be ignored or contradict it.
 */
export function buildPoBillPayload(
  header: HeaderDraft,
  purchaseOrderId: string,
  lines: readonly PoLineDraft[],
): CreateSupplierBillPayload {
  return {
    supplierId: header.supplierId,
    purchaseOrderId,
    supplierInvoiceNumber: header.invoiceNumber.trim(),
    billDate: header.billDate,
    dueDate: header.dueDate,
    currencyCode: 'USD', // Single-currency platform (ADR-024).
    lines: lines.map((line) => ({
      description: line.description.trim(),
      ...figures(line),
      expenseProfileCode: line.expenseProfileCode,
    })),
  };
}

/** `POST /bills` for a direct-expense bill, with the bill's project and each line's target. */
export function buildDirectBillPayload(
  header: HeaderDraft,
  projectChoice: string,
  lines: readonly DirectLineDraft[],
): CreateSupplierBillPayload {
  const projectId = projectChoice && projectChoice !== NO_PROJECT ? projectChoice : undefined;
  return {
    supplierId: header.supplierId,
    supplierInvoiceNumber: header.invoiceNumber.trim(),
    billDate: header.billDate,
    dueDate: header.dueDate,
    currencyCode: 'USD',
    ...(projectId ? { projectId } : {}),
    lines: lines.map(
      (line): CreateSupplierBillLinePayload => ({
        description: line.description.trim(),
        ...figures(line),
        expenseProfileCode: line.expenseProfileCode,
        ...buildCostTargetPayload(directLineCostTarget(projectChoice, line.costLine)),
      }),
    ),
  };
}
