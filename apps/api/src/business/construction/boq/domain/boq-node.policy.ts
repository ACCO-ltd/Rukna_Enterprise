/**
 * Structural validity for a BOQ node — CONST-BOQ-013 and CONST-BOQ-015.
 *
 * Pure: it takes the proposed node plus the context needed to judge it, and returns
 * violations. It never reads the database and never throws — the service turns violations
 * into a `BadRequestException`, and the readiness query reuses the same predicates to
 * explain why a version cannot be baselined.
 *
 * The point of pulling this out of `BoqTreeService` is that the same rules decide two
 * different things: whether a write is accepted, and whether a version is Baseline Ready.
 * Two implementations of "is this item priced" would eventually disagree, and the
 * disagreement would surface as a screen that offers a Baseline button the server refuses.
 */

import { AMOUNT_SCALE, QUANTITY_SCALE, toDecimal, withinScale } from './boq-money.js';

/** Deepest permitted node. Depth is 0-based, so this allows eight levels of hierarchy. */
export const MAX_DEPTH = 7;

export type BoqNodeViolationCode =
  | 'DUPLICATE_CODE'
  | 'SECTION_CARRIES_PRICING'
  | 'ITEM_HAS_CHILDREN'
  | 'PARENT_IS_ITEM'
  | 'QUANTITY_SCALE'
  | 'RATE_SCALE'
  | 'NEGATIVE_QUANTITY'
  | 'NEGATIVE_RATE'
  | 'CURRENCY_MISMATCH'
  | 'MAX_DEPTH_EXCEEDED'
  | 'CIRCULAR_PARENT';

export interface BoqNodeViolation {
  code: BoqNodeViolationCode;
  message: string;
}

/** The proposed state of a node after the write, not the delta. */
export interface ProposedNode {
  code: string;
  isLeaf: boolean;
  unit?: string | null;
  quantity?: string | number | null;
  unitRate?: string | number | null;
  currency?: string | null;
  depth: number;
}

export interface NodeWriteContext {
  /** The BOQ's authoritative currency (CONST-BOQ-013). */
  boqCurrency: string;
  /** Every other item code already in this version. Excludes the node being written. */
  siblingCodes: ReadonlySet<string>;
  /** True when the target parent is itself a leaf item. */
  parentIsItem: boolean;
  /** True when the node already has children — blocks turning it into an item. */
  hasChildren: boolean;
}

export function validateNodeWrite(
  node: ProposedNode,
  context: NodeWriteContext,
): BoqNodeViolation[] {
  const violations: BoqNodeViolation[] = [];

  if (context.siblingCodes.has(node.code)) {
    violations.push({
      code: 'DUPLICATE_CODE',
      message: `Item code "${node.code}" is already used in this version.`,
    });
  }

  if (context.parentIsItem) {
    violations.push({
      code: 'PARENT_IS_ITEM',
      message: 'A billable item cannot contain other nodes. Choose a section as the parent.',
    });
  }

  if (node.depth > MAX_DEPTH) {
    violations.push({
      code: 'MAX_DEPTH_EXCEEDED',
      message: `BOQ hierarchy is limited to ${MAX_DEPTH + 1} levels.`,
    });
  }

  if (node.isLeaf) {
    if (context.hasChildren) {
      violations.push({
        code: 'ITEM_HAS_CHILDREN',
        message: 'Cannot convert a section with children into a billable item.',
      });
    }
    violations.push(...validatePricing(node, context.boqCurrency));
  } else {
    // A section is structural. Letting it carry a rate produces a number that is either
    // ignored or double-counted against its own children's total — neither is defensible.
    const carried = (
      [
        ['unit', node.unit],
        ['quantity', node.quantity],
        ['unit rate', node.unitRate],
      ] as const
    ).filter(([, value]) => value !== null && value !== undefined && value !== '');

    if (carried.length > 0) {
      violations.push({
        code: 'SECTION_CARRIES_PRICING',
        message: `A section cannot carry ${carried.map(([label]) => label).join(', ')}.`,
      });
    }
  }

  return violations;
}

function validatePricing(node: ProposedNode, boqCurrency: string): BoqNodeViolation[] {
  const violations: BoqNodeViolation[] = [];

  const quantity = toDecimal(node.quantity);
  if (quantity !== null) {
    if (quantity.isNegative()) {
      violations.push({ code: 'NEGATIVE_QUANTITY', message: 'Quantity cannot be negative.' });
    }
    if (!withinScale(quantity, QUANTITY_SCALE)) {
      violations.push({
        code: 'QUANTITY_SCALE',
        message: `Quantity supports at most ${QUANTITY_SCALE} decimal places.`,
      });
    }
  }

  const unitRate = toDecimal(node.unitRate);
  if (unitRate !== null) {
    if (unitRate.isNegative()) {
      violations.push({ code: 'NEGATIVE_RATE', message: 'Unit rate cannot be negative.' });
    }
    if (!withinScale(unitRate, AMOUNT_SCALE)) {
      violations.push({
        code: 'RATE_SCALE',
        message: `Unit rate supports at most ${AMOUNT_SCALE} decimal places.`,
      });
    }
  }

  // CONST-BOQ-013. A node may omit the currency — it inherits the BOQ's — but it may never
  // contradict it, because the totals above it add the values together.
  if (node.currency && node.currency !== boqCurrency) {
    violations.push({
      code: 'CURRENCY_MISMATCH',
      message: `This BOQ is denominated in ${boqCurrency}; a node cannot use ${node.currency}.`,
    });
  }

  return violations;
}

/**
 * A billable item is Pricing Complete when it can produce a line amount in the BOQ's
 * currency. Reused verbatim by the readiness query — see CONST-BOQ-016.
 */
export function missingPricingFields(node: {
  isLeaf: boolean;
  unit?: string | null;
  quantity?: unknown;
  unitRate?: unknown;
}): ('unit' | 'quantity' | 'unitRate')[] {
  if (!node.isLeaf) return [];
  const missing: ('unit' | 'quantity' | 'unitRate')[] = [];
  if (!node.unit) missing.push('unit');
  if (toDecimal(node.quantity as never) === null) missing.push('quantity');
  if (toDecimal(node.unitRate as never) === null) missing.push('unitRate');
  return missing;
}
