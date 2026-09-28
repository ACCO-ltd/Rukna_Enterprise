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

import { MONEY_SCALE, QUANTITY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

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
 * Statuses that free a supplier invoice number (the server's LIVE check excludes them): a
 * rejected bill stays on record but its number can be used again on a corrected bill.
 */
const NUMBER_FREEING_STATUSES: readonly SupplierBill['documentStatus'][] = ['REJECTED', 'CANCELLED'];

/**
 * The supplier's existing live bill that already holds this invoice number, or null. Drafts and
 * reversed bills count; rejected and cancelled ones do not. `excludeBillId` is the bill being
 * edited — its own number is never a duplicate of itself.
 */
export function findDuplicateBill(
  bills: readonly SupplierBill[],
  supplierId: string,
  invoiceNumber: string,
  excludeBillId?: string,
): SupplierBill | null {
  const norm = normalizeInvoiceNumber(invoiceNumber);
  if (!supplierId || !norm) return null;
  return (
    bills.find(
      (bill) =>
        bill.id !== excludeBillId &&
        !NUMBER_FREEING_STATUSES.includes(bill.documentStatus) &&
        bill.supplierId === supplierId &&
        normalizeInvoiceNumber(bill.supplierInvoiceNumber) === norm,
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
   * A net amount the clerk typed over `quantity × unit price` — the supplier's invoice says
   * something else (rounding, a discount taken on the total). Empty: the net follows the
   * product. Kept on the saved line next to quantity and unit price, so the difference is on
   * the record (Eng Ahmed, 2026-09-27).
   */
  netOverride: string;
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
    netOverride: '',
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
  /** As on {@link DirectLineDraft.netOverride}. */
  netOverride: string;
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
    netOverride: '',
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

/** The figures a line's net is worked out from. */
export interface NetFigures {
  quantity: string;
  unitPrice: string;
  netOverride: string;
}

/**
 * The line's net in money minor units: the typed override when there is one, otherwise
 * `quantity × unit price`. Null while the figure it rests on is not a number.
 */
export function lineNetMinor(line: NetFigures): number | null {
  if (line.netOverride.trim() !== '') return parseMinorUnits(line.netOverride, MONEY_SCALE);
  return lineAmountMinor(line);
}

export interface NetVariance {
  /** `quantity × unit price`. */
  computedMinor: number;
  /** The net the line carries. */
  netMinor: number;
  /** `net − computed`; negative when the invoice charges less than the product. */
  diffMinor: number;
}

/**
 * How far a typed net departs from `quantity × unit price`, or null when it does not (no
 * override, an override equal to the product, or a figure not yet a number).
 */
export function netVariance(line: NetFigures): NetVariance | null {
  if (line.netOverride.trim() === '') return null;
  const netMinor = parseMinorUnits(line.netOverride, MONEY_SCALE);
  const computedMinor = lineAmountMinor(line);
  if (netMinor === null || computedMinor === null || netMinor === computedMinor) return null;
  return { computedMinor, netMinor, diffMinor: netMinor - computedMinor };
}

/**
 * The variance a saved bill line carries — its net against its own `quantity × unit price` —
 * so the bill shows the difference the clerk accepted. Null for a line without quantity and
 * price (written before lines carried them), or priced finer than cents, where the form's
 * product was never the reference.
 */
export function savedNetVariance(line: {
  quantity: string | null;
  unitPrice: string | null;
  netAmount: string;
}): NetVariance | null {
  if (line.quantity === null || line.unitPrice === null) return null;
  const cents = /^-?\d*(?:\.(\d*))?$/.exec(line.unitPrice.trim());
  if (!cents || /[1-9]/.test((cents[1] ?? '').slice(MONEY_SCALE))) return null;
  return netVariance({ quantity: line.quantity, unitPrice: line.unitPrice, netOverride: line.netAmount });
}

export interface BillTotalsMinor {
  subtotal: number;
  vat: number;
  total: number;
}

/** Subtotal (Σ net), VAT and Total, in minor units. A line not yet complete counts as zero. */
export function billTotalsMinor(lines: readonly (NetFigures & { vatAmount: string })[]): BillTotalsMinor {
  let subtotal = 0;
  let vat = 0;
  for (const line of lines) {
    subtotal += lineNetMinor(line) ?? 0;
    vat += parseMinorUnits(line.vatAmount, MONEY_SCALE) ?? 0;
  }
  return { subtotal, vat, total: subtotal + vat };
}

// ─── Line validation ─────────────────────────────────────────────────────────────

/** Keys under `procurement.bills.lineError` (and `create.errors.costLine`). */
export type LineErrorKey = 'description' | 'profile' | 'quantity' | 'unitPrice' | 'net' | 'vat' | 'costLine';

export type LineErrors = Partial<
  Record<'description' | 'profile' | 'quantity' | 'unitPrice' | 'vat' | 'amount' | 'costLine', LineErrorKey>
>;

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
 * - A typed net must be a number of zero or more — it is what the line posts.
 */
function figureErrors(line: NetFigures & { vatAmount: string }): LineErrors {
  const errors: LineErrors = {};
  const qty = parseMinorUnits(line.quantity, QUANTITY_SCALE);
  if (qty === null || qty <= 0) errors.quantity = 'quantity';

  const price = parseMinorUnits(line.unitPrice, MONEY_SCALE);
  if (price === null || price < 0) errors.unitPrice = 'unitPrice';
  else if (!errors.quantity && lineAmountMinor(line) === null) errors.unitPrice = 'net';

  const vat = parseMinorUnits(line.vatAmount, MONEY_SCALE);
  if (vat === null || vat < 0) errors.vat = 'vat';

  if (line.netOverride.trim() !== '') {
    const net = parseMinorUnits(line.netOverride, MONEY_SCALE);
    if (net === null || net < 0) errors.amount = 'net';
  }
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

function figures(line: NetFigures & { vatAmount: string }) {
  return {
    quantity: quantityToApi(parseMinorUnits(line.quantity, QUANTITY_SCALE) ?? 0),
    unitPrice: moneyToApi(parseMinorUnits(line.unitPrice, MONEY_SCALE) ?? 0),
    netAmount: moneyToApi(lineNetMinor(line) ?? 0),
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

// ─── Edit: an existing draft back into the form ──────────────────────────────────

/** The figures a PO-backed bill line carries, laid over the PO line it bills. */
export interface BilledFigures {
  /** The PO line this bill line bills, when the server recorded it; else matched by position. */
  poLineId: string | null;
  quantity: string;
  unitPrice: string;
  vatAmount: string;
  netOverride: string;
  expenseProfileCode: string;
}

/** Everything the form holds, as an existing bill describes it. */
export interface BillFormValues {
  kind: BillKind;
  supplierId: string;
  invoiceNumber: string;
  purchaseOrderId: string;
  projectChoice: string;
  billDate: string;
  dueDate: string;
  /** Direct bills: the lines as drafts. Empty for a PO bill. */
  directLines: DirectLineDraft[];
  /** PO bills: what each line bills, applied once the PO's lines load. Empty for a direct bill. */
  poFigures: BilledFigures[];
}

/** `2026-09-01T00:00:00.000Z` → `2026-09-01`; already-plain dates pass through. */
function isoDay(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

/** A decimal string from the API, as a person would type it: `12.5000` → `12.5`, `3.000` → `3`. */
function plainQuantity(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const minor = parseMinorUnits(value, QUANTITY_SCALE);
  if (minor === null) return value;
  return fromMinorUnits(minor, QUANTITY_SCALE).replace(/\.?0+$/, '');
}

/** A money string from the API at the form's 2dp: `100.5000` → `100.50`. */
function plainMoney(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const minor = parseMinorUnits(value, MONEY_SCALE);
  return minor === null ? value : fromMinorUnits(minor, MONEY_SCALE);
}

/**
 * The form values for editing `bill` — every header field and every line.
 *
 * A line with no quantity or unit price (written before lines carried them) reads as quantity 1
 * at its net amount, so its Amount — and the bill's total — is what it was. A line saved with a
 * net that differs from `quantity × unit price` comes back with that net as its override.
 */
export function billToFormValues(bill: SupplierBill): BillFormValues {
  const lines = [...(bill.lines ?? [])].sort((a, b) => a.lineNumber - b.lineNumber);
  const figuresOf = (line: NonNullable<SupplierBill['lines']>[number]) => {
    const priced = line.quantity !== null && line.unitPrice !== null;
    const quantity = priced ? plainQuantity(line.quantity) : '1';
    const unitPrice = priced ? plainMoney(line.unitPrice) : plainMoney(line.netAmount);
    const net = plainMoney(line.netAmount);
    const computed = lineAmountMinor({ quantity, unitPrice });
    const saved = parseMinorUnits(net, MONEY_SCALE);
    return {
      quantity,
      unitPrice,
      vatAmount: plainMoney(line.vatAmount),
      netOverride: saved !== null && computed !== null && saved !== computed ? net : '',
    };
  };

  const header = {
    supplierId: bill.supplierId,
    invoiceNumber: bill.supplierInvoiceNumber,
    billDate: isoDay(bill.billDate),
    dueDate: isoDay(bill.dueDate),
  };

  if (bill.purchaseOrderId) {
    return {
      ...header,
      kind: 'po',
      purchaseOrderId: bill.purchaseOrderId,
      projectChoice: '',
      directLines: [],
      poFigures: lines.map((line) => ({
        poLineId: line.purchaseOrderLineId ?? null,
        ...figuresOf(line),
        expenseProfileCode: line.expenseProfileCode,
      })),
    };
  }

  return {
    ...header,
    kind: 'direct',
    purchaseOrderId: '',
    // A direct bill saved with no project was an explicit "no project" — the form required it.
    projectChoice: bill.projectId ?? NO_PROJECT,
    directLines: lines.map((line) => ({
      ...emptyDirectLine(),
      description: line.description,
      expenseProfileCode: line.expenseProfileCode,
      ...figuresOf(line),
      costLine: line.boqNodeId
        ? `node:${line.boqNodeId}`
        : line.spendCategoryId
          ? `category:${line.spendCategoryId}`
          : '',
    })),
    poFigures: [],
  };
}

/**
 * Lays a saved bill's figures over freshly seeded PO lines: by recorded PO line where the bill
 * has one, otherwise by position — the order the lines were created in. A PO line the bill does
 * not cover keeps its seeded values.
 */
export function applyBilledFigures(
  seeded: readonly PoLineDraft[],
  figures: readonly BilledFigures[],
): PoLineDraft[] {
  const byPoLine = new Map(
    figures.filter((f) => f.poLineId).map((f) => [f.poLineId as string, f]),
  );
  return seeded.map((line, index) => {
    const figure = byPoLine.size > 0 ? byPoLine.get(line.poLineId) : figures[index];
    if (!figure) return line;
    return {
      ...line,
      quantity: figure.quantity,
      unitPrice: figure.unitPrice,
      vatAmount: figure.vatAmount,
      netOverride: figure.netOverride,
      expenseProfileCode: figure.expenseProfileCode,
    };
  });
}
