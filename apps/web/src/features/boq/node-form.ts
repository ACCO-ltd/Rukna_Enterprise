import type { CreateNodePayload, UpdateNodePayload } from './api/boq-api';
import type { BoqTreeNode } from './types';

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

export interface NodeFormValues {
  code: string;
  description: string;
  descriptionAr: string;
  unit: string;
  quantity: string;
  unitRate: string;
}

export const EMPTY_NODE_FORM: NodeFormValues = {
  code: '',
  description: '',
  descriptionAr: '',
  unit: '',
  quantity: '',
  unitRate: '',
};

export function toNodeFormValues(node: BoqTreeNode): NodeFormValues {
  return {
    code: node.code,
    description: node.description,
    descriptionAr: node.descriptionAr ?? '',
    unit: node.unit ?? '',
    quantity: node.quantity ?? '',
    unitRate: node.unitRate ?? '',
  };
}

/**
 * Builds the create payload.
 *
 * CURRENCY IS NOT A FORM FIELD. It is taken from the project's contract currency and
 * written onto every priced node, rather than being chosen per node.
 *
 * The API models `currency` as an optional per-node field, which permits a BOQ whose
 * sections are denominated differently and whose parent totals are therefore meaningless —
 * see subtree-currency.ts and D1. Offering a per-node currency picker would be building the
 * feature that creates that problem while the tree deliberately hides its consequences.
 * Locking to the project keeps the data internally consistent by construction.
 *
 * This is a documented assumption, not a discovered rule. If ACCO confirms a BOQ may hold
 * several currencies, this is where the picker goes and nothing else needs to change.
 *
 * A project with no contract currency yields unlabelled amounts, which is honest: the
 * figure is real, the denomination simply is not recorded yet.
 */
export function toCreateNodePayload(
  values: NodeFormValues,
  options: {
    kind: NodeKind;
    sortOrder: number;
    parentId?: string | undefined;
    projectCurrency: string | null;
  },
): CreateNodePayload {
  const payload: CreateNodePayload = {
    sortOrder: options.sortOrder,
    code: values.code.trim(),
    description: values.description.trim(),
    isLeaf: options.kind === 'item',
  };

  if (options.parentId) payload.parentId = options.parentId;

  const descriptionAr = values.descriptionAr.trim();
  if (descriptionAr) payload.descriptionAr = descriptionAr;

  // Sections carry no quantities: the server computes their total from descendants, and
  // sending a rate on a section would be silently ignored while implying it was priced.
  if (options.kind === 'item') {
    const unit = values.unit.trim();
    if (unit) payload.unit = unit;

    const quantity = parseDecimal(values.quantity);
    if (quantity !== null) payload.quantity = quantity;

    const unitRate = parseDecimal(values.unitRate);
    if (unitRate !== null) payload.unitRate = unitRate;

    // Only a priced row needs a denomination.
    if (options.projectCurrency && (quantity !== null || unitRate !== null)) {
      payload.currency = options.projectCurrency;
    }
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
  options: { kind: NodeKind; projectCurrency: string | null },
): UpdateNodePayload {
  const payload: UpdateNodePayload = {
    code: values.code.trim(),
    description: values.description.trim(),
    descriptionAr: values.descriptionAr.trim() || undefined,
  };

  if (options.kind === 'item') {
    payload.unit = values.unit.trim() || undefined;

    const quantity = parseDecimal(values.quantity);
    const unitRate = parseDecimal(values.unitRate);

    if (quantity !== null) payload.quantity = quantity;
    if (unitRate !== null) payload.unitRate = unitRate;

    if (options.projectCurrency && (quantity !== null || unitRate !== null)) {
      payload.currency = options.projectCurrency;
    }
  }

  return payload;
}

/** Returns null for blank or non-numeric input rather than NaN. */
function parseDecimal(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Preview of the amount an item will carry once saved.
 *
 * The server owns the real figure — it recomputes quantity × unitRate on write — so this
 * is explicitly a preview and is never persisted or summed. It exists so a quantity
 * surveyor can sanity-check a rate before committing it.
 */
export function previewLineTotal(values: NodeFormValues): number | null {
  const quantity = parseDecimal(values.quantity);
  const unitRate = parseDecimal(values.unitRate);
  if (quantity === null || unitRate === null) return null;

  return Math.round(quantity * unitRate * 100) / 100;
}
