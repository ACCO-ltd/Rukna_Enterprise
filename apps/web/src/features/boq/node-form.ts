import type { BoqTreeNodeResponse } from '@erp/types';

import { fromMinorUnits, parseMinorUnits } from '@/lib/money';

import type { CreateNodePayload, UpdateNodePayload } from './api/boq-api';

/** Mirrors CreateNodeDto's constraints so the user is not sent to the server to be refused. */
export const NODE_LIMITS = {
  codeMax: 50,
  descriptionMax: 500,
  unitMax: 20,
  quantityDecimals: 3,
  rateDecimals: 2,
} as const;

/** A section groups other rows; an item carries the quantity and rate. */
export type NodeKind = 'section' | 'item';

export type MeasurementMethodValue = 'QUANTITY' | 'PERCENTAGE' | 'MILESTONE';
export type PricingBasisValue = 'UNIT_RATE' | 'LUMP_SUM';

export interface NodeFormValues {
  code: string;
  description: string;
  unit: string;
  quantity: string;
  unitRate: string;
  measurementMethod: MeasurementMethodValue;
  pricingBasis: PricingBasisValue;
  /**
   * The one fixed amount of a lump-sum item. Only read when `pricingBasis` is `LUMP_SUM`.
   *
   * Not a server field. A lump sum is stored the way the rest of the BOQ already stores one —
   * the absorbed-scope line, contingency draws, the grid's "Lump sum" cell — as `quantity = 1`
   * and `unitRate = amount`, so `totalAmount = quantity × unitRate` stays true everywhere. The
   * form keeps the amount apart from `quantity`/`unitRate` so switching the pricing basis back
   * and forth does not throw away a measured quantity the user typed.
   */
  lumpSumAmount: string;
}

export const EMPTY_NODE_FORM: NodeFormValues = {
  code: '',
  description: '',
  unit: '',
  quantity: '',
  unitRate: '',
  measurementMethod: 'QUANTITY',
  pricingBasis: 'UNIT_RATE',
  lumpSumAmount: '',
};

export function toNodeFormValues(node: BoqTreeNodeResponse): NodeFormValues {
  return {
    code: node.code,
    description: node.description,
    unit: node.unit ?? '',
    quantity: node.quantity ?? '',
    unitRate: node.unitRate ?? '',
    measurementMethod: node.measurementMethod,
    pricingBasis: node.pricingBasis,
    lumpSumAmount: node.pricingBasis === 'LUMP_SUM' ? lumpSumOf(node.quantity, node.unitRate) : '',
  };
}

/**
 * The fixed amount a lump-sum item carries: its rate when the quantity is 1 (or unset), which is
 * how every lump sum is written; otherwise quantity × rate, so a legacy lump sum stored with some
 * other quantity still shows the amount it actually totals to.
 */
export function lumpSumOf(quantity: string | null, unitRate: string | null): string {
  if (!unitRate) return '';
  if (quantity === null || quantity.trim() === '' || Number(quantity) === 1) return unitRate;
  return previewUnitRateTotal(quantity, unitRate) ?? '';
}

/**
 * Builds the create payload.
 *
 * **Currency is not a form field and is no longer sent.** A BOQ has one currency, fixed at
 * initialization from the project, and the server stamps it onto every priced node
 * (CONST-BOQ-013). This module used to write the project's currency onto each node itself,
 * as a frontend guard against the API's per-node currency permitting a BOQ whose sections
 * were denominated differently — that guard is now a backend invariant, so the client
 * stopped asserting it.
 *
 * **Quantity and rate are sent as decimal strings**, not numbers (CONST-BOQ-014). The user
 * typed `"680.500"`; converting that to a float and back is a lossy round trip for no gain.
 * `sortOrder` is omitted so the server appends — sibling positions are dense and
 * server-owned (CONST-BOQ-017).
 */
export function toCreateNodePayload(
  values: NodeFormValues,
  options: {
    kind: NodeKind;
    parentId?: string | undefined;
    /**
     * False for a reader without the cost tier: the rate, the pricing basis and a lump sum's
     * amount were never shown, so none of them is sent (the server would refuse a scope-only
     * editor pricing a line anyway — ADR-029 §8 A-1).
     */
    pricing?: boolean;
  },
): CreateNodePayload {
  const pricing = options.pricing ?? true;
  const payload: CreateNodePayload = {
    description: values.description.trim(),
    isLeaf: options.kind === 'item',
  };

  // D2: an empty code means "auto-number" — omit it so the server assigns from tree position.
  // A non-empty code is an explicit override (the "Advanced" path in the dialog).
  const code = values.code.trim();
  if (code) payload.code = code;

  if (options.parentId) payload.parentId = options.parentId;

  // Sections carry no measurement or pricing: the server rejects them outright, and a rate
  // on a section would either be ignored or double-counted against its children's total.
  if (options.kind === 'item') {
    const unit = values.unit.trim();
    if (unit) payload.unit = unit;
    payload.measurementMethod = values.measurementMethod;

    if (pricing) {
      const { quantity, unitRate } = pricedFields(values);
      if (quantity !== null) payload.quantity = quantity;
      if (unitRate !== null) payload.unitRate = unitRate;
      payload.pricingBasis = values.pricingBasis;
    } else if (values.pricingBasis === 'UNIT_RATE') {
      // A measured quantity is scope, not money.
      const quantity = normaliseDecimal(values.quantity);
      if (quantity !== null) payload.quantity = quantity;
    }
  }

  return payload;
}

/**
 * Builds the update payload: **only what the user changed.**
 *
 * `PATCH …/nodes/:id` is partial — an absent field keeps its stored value — so a field the user did
 * not touch is not sent. That matters for three reasons the old "re-send the whole row" did not
 * honour:
 *  - a lump sum stored as some quantity other than 1 (an imported `5 × 100`) is not rewritten to
 *    `1 × 500` by a description edit;
 *  - a stored unit spelling (`m2`) is not normalised behind the user's back — it is only sent, as
 *    the listed symbol, when the user picked a unit;
 *  - a reader without the cost tier never sends a rate, basis or amount it was not shown.
 *
 * `isLeaf` is deliberately absent: switching a section to an item is refused by the server once it
 * has children. Clearing a unit is not offered either (the DTO has no null for it).
 */
export function toUpdateNodePayload(
  values: NodeFormValues,
  options: {
    kind: NodeKind;
    /** What the form opened with — `toNodeFormValues(node)`. */
    initial: NodeFormValues;
    /** False without the cost tier — see `toCreateNodePayload`. */
    pricing?: boolean;
  },
): UpdateNodePayload {
  const { initial } = options;
  const pricing = options.pricing ?? true;
  const payload: UpdateNodePayload = {};

  const code = values.code.trim();
  if (code !== initial.code.trim()) payload.code = code;
  const description = values.description.trim();
  if (description !== initial.description.trim()) payload.description = description;

  if (options.kind !== 'item') return payload;

  const unit = values.unit.trim();
  if (unit && unit !== initial.unit.trim()) payload.unit = unit;
  if (values.measurementMethod !== initial.measurementMethod) {
    payload.measurementMethod = values.measurementMethod;
  }

  const basisChanged = values.pricingBasis !== initial.pricingBasis;
  if (!pricing) {
    // Scope only: a measured quantity. Never the basis, the rate or a lump sum's amount.
    if (values.pricingBasis === 'UNIT_RATE' && values.quantity !== initial.quantity) {
      const quantity = normaliseDecimal(values.quantity);
      if (quantity !== null) payload.quantity = quantity;
    }
    return payload;
  }

  if (basisChanged) payload.pricingBasis = values.pricingBasis;

  if (values.pricingBasis === 'LUMP_SUM') {
    // quantity 1 × rate = amount, written only when the amount (or the basis) actually changed.
    if (basisChanged || values.lumpSumAmount !== initial.lumpSumAmount) {
      const { quantity, unitRate } = pricedFields(values);
      if (quantity !== null) payload.quantity = quantity;
      if (unitRate !== null) payload.unitRate = unitRate;
    }
    return payload;
  }

  if (basisChanged || values.quantity !== initial.quantity) {
    const quantity = normaliseDecimal(values.quantity);
    if (quantity !== null) payload.quantity = quantity;
  }
  if (basisChanged || values.unitRate !== initial.unitRate) {
    const unitRate = normaliseDecimal(values.unitRate);
    if (unitRate !== null) payload.unitRate = unitRate;
  }
  return payload;
}

/**
 * The quantity and rate an item is saved with.
 *
 * Unit rate: what was typed. Lump sum: `quantity = 1` and `unitRate = amount` — the existing
 * model (see `lumpSumAmount`), not a new one. With no amount typed, neither is sent, so a
 * lump sum is never saved as a confident zero.
 */
function pricedFields(values: NodeFormValues): { quantity: string | null; unitRate: string | null } {
  if (values.pricingBasis === 'LUMP_SUM') {
    const amount = normaliseDecimal(values.lumpSumAmount);
    return amount === null ? { quantity: null, unitRate: null } : { quantity: '1', unitRate: amount };
  }
  return { quantity: normaliseDecimal(values.quantity), unitRate: normaliseDecimal(values.unitRate) };
}

/**
 * Validates and normalises a typed decimal, without going through `Number`.
 *
 * Returns null for blank or malformed input. Keeping the string means `"680.500"` reaches
 * the server exactly as typed, trailing zeros and all — trailing zeros in a BOQ quantity
 * are a statement about measurement precision.
 */
function normaliseDecimal(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
}

/**
 * Preview of the amount an item will carry once saved.
 *
 * The server owns the real figure — it recomputes quantity × unitRate in Decimal on write —
 * so this is explicitly a preview and is never persisted or summed. It exists so a quantity
 * surveyor can sanity-check a rate before committing it.
 *
 * Computed through `lib/money.ts` in integer minor units rather than with float
 * multiplication, so the preview and the saved value agree to the cent.
 */
export function previewLineTotal(values: NodeFormValues): string | null {
  if (values.pricingBasis === 'LUMP_SUM') {
    const amount = parseMinorUnits(values.lumpSumAmount, NODE_LIMITS.rateDecimals);
    return amount === null ? null : fromMinorUnits(amount, NODE_LIMITS.rateDecimals);
  }
  return previewUnitRateTotal(values.quantity, values.unitRate);
}

function previewUnitRateTotal(quantityText: string, unitRateText: string): string | null {
  const quantity = parseMinorUnits(quantityText, NODE_LIMITS.quantityDecimals);
  const unitRate = parseMinorUnits(unitRateText, NODE_LIMITS.rateDecimals);
  if (quantity === null || unitRate === null) return null;

  // quantity is scaled by 10³ and rate by 10², so the product carries 10⁵. Dividing by 10³
  // brings it back to the amount's two decimal places; rounding matches the server's
  // Decimal.toDecimalPlaces(2).
  const product = quantity * unitRate;
  if (!Number.isSafeInteger(product)) return null;

  const amountMinor = Math.round(product / 10 ** NODE_LIMITS.quantityDecimals);
  return fromMinorUnits(amountMinor, NODE_LIMITS.rateDecimals);
}
