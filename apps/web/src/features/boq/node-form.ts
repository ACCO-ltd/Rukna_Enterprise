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
}

export const EMPTY_NODE_FORM: NodeFormValues = {
  code: '',
  description: '',
  unit: '',
  quantity: '',
  unitRate: '',
  measurementMethod: 'QUANTITY',
  pricingBasis: 'UNIT_RATE',
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
  };
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
  options: { kind: NodeKind; parentId?: string | undefined },
): CreateNodePayload {
  const payload: CreateNodePayload = {
    code: values.code.trim(),
    description: values.description.trim(),
    isLeaf: options.kind === 'item',
  };

  if (options.parentId) payload.parentId = options.parentId;


  // Sections carry no measurement or pricing: the server rejects them outright, and a rate
  // on a section would either be ignored or double-counted against its children's total.
  if (options.kind === 'item') {
    const unit = values.unit.trim();
    if (unit) payload.unit = unit;

    const quantity = normaliseDecimal(values.quantity);
    if (quantity !== null) payload.quantity = quantity;

    const unitRate = normaliseDecimal(values.unitRate);
    if (unitRate !== null) payload.unitRate = unitRate;

    payload.measurementMethod = values.measurementMethod;
    payload.pricingBasis = values.pricingBasis;
  }

  return payload;
}

/**
 * Builds the update payload.
 *
 * `isLeaf` is deliberately absent: switching a section to an item is refused by the server
 * once it has children, and the two shapes collect different fields. Changing kind means
 * deleting and re-adding, which is explicit about what happens to the children.
 */
export function toUpdateNodePayload(
  values: NodeFormValues,
  options: { kind: NodeKind },
): UpdateNodePayload {
  const payload: UpdateNodePayload = {
    code: values.code.trim(),
    description: values.description.trim(),
  };

  if (options.kind === 'item') {
    payload.unit = values.unit.trim() || undefined;

    const quantity = normaliseDecimal(values.quantity);
    const unitRate = normaliseDecimal(values.unitRate);
    if (quantity !== null) payload.quantity = quantity;
    if (unitRate !== null) payload.unitRate = unitRate;

    payload.measurementMethod = values.measurementMethod;
    payload.pricingBasis = values.pricingBasis;
  }

  return payload;
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
  const quantity = parseMinorUnits(values.quantity, NODE_LIMITS.quantityDecimals);
  const unitRate = parseMinorUnits(values.unitRate, NODE_LIMITS.rateDecimals);
  if (quantity === null || unitRate === null) return null;

  // quantity is scaled by 10³ and rate by 10², so the product carries 10⁵. Dividing by 10³
  // brings it back to the amount's two decimal places; rounding matches the server's
  // Decimal.toDecimalPlaces(2).
  const product = quantity * unitRate;
  if (!Number.isSafeInteger(product)) return null;

  const amountMinor = Math.round(product / 10 ** NODE_LIMITS.quantityDecimals);
  return fromMinorUnits(amountMinor, NODE_LIMITS.rateDecimals);
}
