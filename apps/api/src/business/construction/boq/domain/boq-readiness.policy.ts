/**
 * Baseline readiness — CONST-BOQ-016.
 *
 * One policy, two callers: `GET …/readiness` renders it, and `baseline` enforces it. That
 * is the whole point. Before this existed, the screen decided whether to offer a Baseline
 * button and the server decided whether to honour it, using different reasoning — so an
 * empty BOQ, a BOQ with duplicate codes, and a BOQ of unpriced items could all be
 * baselined, and a baselined version is what a contract is signed against and every
 * certificate is claimed from.
 *
 * Pure and synchronous: the caller supplies the nodes.
 */

import type { BoqNode } from '@prisma/client';

import { formatAmount, sumAmounts, toDecimal, type DecimalString } from './boq-money.js';
import { missingPricingFields } from './boq-node.policy.js';

export type BoqReadinessBlockerKind =
  | 'NO_BILLABLE_ITEMS'
  | 'DUPLICATE_CODE'
  | 'MISSING_UNIT'
  | 'MISSING_QUANTITY'
  | 'MISSING_RATE'
  | 'CURRENCY_MISMATCH'
  | 'STRUCTURE_INVALID'
  | 'VARIATION_REQUIRED';

export interface BoqReadinessBlocker {
  kind: BoqReadinessBlockerKind;
  /** Null for version-wide blockers such as an empty BOQ. */
  nodeId: string | null;
  code: string | null;
  description: string | null;
  message: string;
}

export interface BoqReadinessWarning {
  kind: 'ZERO_QUANTITY' | 'ZERO_RATE' | 'EMPTY_SECTION' | 'INACTIVE_ITEM';
  nodeId: string;
  code: string;
  message: string;
}

export interface BoqBaselineReadiness {
  ready: boolean;
  sectionCount: number;
  itemCount: number;
  pricedItemCount: number;
  incompleteItemCount: number;
  duplicateCodeCount: number;
  totalAmount: DecimalString | null;
  currency: string;
  blockers: BoqReadinessBlocker[];
  warnings: BoqReadinessWarning[];
}

export interface ReadinessContext {
  boqCurrency: string;
  /**
   * True once the BOQ has an approved baseline — a revision is post-award scope change and
   * CONST-BOQ-001 requires it to originate from a Variation Order.
   */
  isPostAward: boolean;
  /**
   * CONST-BOQ-001 enforcement switch. Off until the Variations module exists; flipping it
   * on without Change Orders would block every legitimate revision with no way to satisfy
   * the rule.
   */
  enforceVariationOrigin: boolean;
}

export function evaluateReadiness(
  nodes: BoqNode[],
  context: ReadinessContext,
): BoqBaselineReadiness {
  const blockers: BoqReadinessBlocker[] = [];
  const warnings: BoqReadinessWarning[] = [];

  const items = nodes.filter((node) => node.isLeaf);
  const sections = nodes.filter((node) => !node.isLeaf);

  // Sections may be empty; a BOQ may not. A version with no billable line has nothing to
  // certify against and nothing to invoice from.
  if (items.length === 0) {
    blockers.push({
      kind: 'NO_BILLABLE_ITEMS',
      nodeId: null,
      code: null,
      description: null,
      message: 'This BOQ has no billable items. Add at least one item before baselining.',
    });
  }

  const seen = new Map<string, BoqNode>();
  const duplicated = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.code)) {
      duplicated.add(node.code);
      blockers.push({
        kind: 'DUPLICATE_CODE',
        nodeId: node.id,
        code: node.code,
        description: node.description,
        message: `Code "${node.code}" is used more than once.`,
      });
    } else {
      seen.set(node.code, node);
    }
  }

  let pricedItemCount = 0;

  for (const item of items) {
    const missing = missingPricingFields(item);
    if (missing.length === 0) pricedItemCount += 1;

    for (const field of missing) {
      blockers.push({
        kind:
          field === 'unit'
            ? 'MISSING_UNIT'
            : field === 'quantity'
              ? 'MISSING_QUANTITY'
              : 'MISSING_RATE',
        nodeId: item.id,
        code: item.code,
        description: item.description,
        message: `Item ${item.code} is missing a ${field === 'unitRate' ? 'rate' : field}.`,
      });
    }

    if (item.currency && item.currency !== context.boqCurrency) {
      blockers.push({
        kind: 'CURRENCY_MISMATCH',
        nodeId: item.id,
        code: item.code,
        description: item.description,
        message: `Item ${item.code} is priced in ${item.currency}, but this BOQ is in ${context.boqCurrency}.`,
      });
    }

    // Zero is legal — a provisional or omitted item — but it is worth surfacing, because a
    // zero rate and a missing rate look identical on a printed BOQ.
    const quantity = toDecimal(item.quantity);
    if (quantity?.isZero()) {
      warnings.push({
        kind: 'ZERO_QUANTITY',
        nodeId: item.id,
        code: item.code,
        message: `Item ${item.code} has a zero quantity.`,
      });
    }
    const rate = toDecimal(item.unitRate);
    if (rate?.isZero()) {
      warnings.push({
        kind: 'ZERO_RATE',
        nodeId: item.id,
        code: item.code,
        message: `Item ${item.code} has a zero rate.`,
      });
    }
    if (!item.isActive) {
      warnings.push({
        kind: 'INACTIVE_ITEM',
        nodeId: item.id,
        code: item.code,
        message: `Item ${item.code} is deactivated and will not be claimable.`,
      });
    }
  }

  const withChildren = new Set(nodes.map((node) => node.parentId).filter(Boolean) as string[]);
  for (const section of sections) {
    if (!withChildren.has(section.id)) {
      warnings.push({
        kind: 'EMPTY_SECTION',
        nodeId: section.id,
        code: section.code,
        message: `Section ${section.code} contains no items.`,
      });
    }
  }

  // CONST-BOQ-001. Defined now so the contract is stable; enforced when Variations ships.
  if (context.enforceVariationOrigin && context.isPostAward) {
    const unbacked = nodes.filter(
      (node) => node.sourceType !== 'VARIATION' || !node.sourceChangeOrderId,
    );
    if (unbacked.length > 0) {
      blockers.push({
        kind: 'VARIATION_REQUIRED',
        nodeId: null,
        code: null,
        description: null,
        message:
          'Post-award scope changes must originate from an approved Variation Order (CONST-BOQ-001).',
      });
    }
  }

  const totalAmount = formatAmount(
    sumAmounts(items.map((item) => toDecimal(item.totalAmount))),
  );

  return {
    ready: blockers.length === 0,
    sectionCount: sections.length,
    itemCount: items.length,
    pricedItemCount,
    incompleteItemCount: items.length - pricedItemCount,
    duplicateCodeCount: duplicated.size,
    totalAmount,
    currency: context.boqCurrency,
    blockers,
    warnings,
  };
}
