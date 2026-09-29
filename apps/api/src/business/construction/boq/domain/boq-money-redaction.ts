import { ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  PERMISSIONS,
  type BoqBaselineReadinessResponse,
  type BoqChangeEventResponse,
  type BoqCompareResponse,
  type RequestIdentity,
} from '@erp/types';

/**
 * ADR-029 §8 A-2 — BOQ money is withheld by the SERVER from a caller without the cost tier
 * (`resolveBoqVisibility(identity).canViewCost`), never merely hidden by the UI.
 *
 * The workspace read model already did this for version totals and compare-to-signed. The raw
 * reads beside it did not: the tree, the node write responses, the change log, the peer compare
 * and the readiness summary all returned rates and amounts to a money-blind editor (a PM or Site
 * Engineer holding `view:boq` / `edit-scope:boq`). These pure functions null the same fields the
 * workspace nulls — rate, line amount, rolled-up totals — and leave every structural fact
 * (codes, descriptions, units, quantities, pricing basis) in place.
 *
 * Applied at the controller boundary so the services keep returning full figures to their
 * internal callers (contract signing, Commercial, the extra-work classifier).
 */

/** The money fields a tree node or a stored node can carry. */
interface NodeMoney {
  unitRate?: unknown;
  totalAmount?: unknown;
  computedTotal?: unknown;
  children?: unknown;
}

/** One node (tree view or stored row) with its rate and amounts withheld; recurses into children. */
export function redactNodeMoney<T extends NodeMoney>(node: T): T {
  const redacted: T = { ...node, unitRate: null, totalAmount: null };
  if ('computedTotal' in node) (redacted as NodeMoney).computedTotal = null;
  if (Array.isArray(node.children)) {
    (redacted as NodeMoney).children = (node.children as NodeMoney[]).map((child) => redactNodeMoney(child));
  }
  return redacted;
}

export function redactTreeMoney<T extends NodeMoney>(nodes: readonly T[]): T[] {
  return nodes.map((node) => redactNodeMoney(node));
}

/** Change-log fields whose values are money. */
const MONEY_FIELDS = new Set(['unitRate', 'totalAmount']);

/**
 * The change log without money: a rate or amount change keeps its row (who changed which line,
 * when) but loses the values, and a free-text detail that quotes a figure (a contingency draw) is
 * withheld with it.
 */
export function redactHistoryMoney(events: readonly BoqChangeEventResponse[]): BoqChangeEventResponse[] {
  return events.map((event) =>
    event.field && MONEY_FIELDS.has(event.field)
      ? { ...event, oldValue: null, newValue: null, detail: null }
      : event,
  );
}

/** The peer-version compare without money — the same fields `redactChange` nulls on compare-to-signed. */
export function redactCompareMoney(response: BoqCompareResponse): BoqCompareResponse {
  return {
    ...response,
    leftTotal: null,
    rightTotal: null,
    netDelta: null,
    changes: response.changes.map((change) => ({
      ...change,
      oldUnitRate: null,
      newUnitRate: null,
      oldAmount: null,
      newAmount: null,
      amountDelta: null,
      amountDeltaPercent: null,
    })),
  };
}

export function redactReadinessMoney<T extends Pick<BoqBaselineReadinessResponse, 'totalAmount'>>(
  readiness: T,
): T {
  return { ...readiness, totalAmount: null };
}

// ─── Writes ───────────────────────────────────────────────────────────────────

/**
 * ADR-029 §8 A-1 — who may change BOQ money. `edit-cost:boq` or the `manage:boq` umbrella; an
 * `edit-scope:boq`-only editor changes descriptions, quantities, units and structure, not rates.
 */
export function canEditBoqCost(identity: RequestIdentity): boolean {
  const permissions = identity.permissions ?? [];
  return permissions.includes(PERMISSIONS.boqManage) || permissions.includes(PERMISSIONS.boqEditCost);
}

/** A scope-only editor: may edit the BOQ, may not edit its money. */
function isScopeOnlyEditor(identity: RequestIdentity): boolean {
  return (identity.permissions ?? []).includes(PERMISSIONS.boqEditScope) && !canEditBoqCost(identity);
}

type DecimalLike = Decimal | string | number | null | undefined;

function sameDecimal(a: DecimalLike, b: DecimalLike): boolean {
  const empty = (value: DecimalLike) => value === null || value === undefined || value === '';
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  try {
    return new Decimal(a!.toString()).equals(new Decimal(b!.toString()));
  } catch {
    return false;
  }
}

/** What a write proposes for the money-bearing fields; absent fields are `undefined`. */
export interface ProposedMoney {
  unitRate?: string | null | undefined;
  pricingBasis?: string | undefined;
  quantity?: string | null | undefined;
}

/** The node as stored, or null for a create. */
export interface StoredMoney {
  unitRate: DecimalLike;
  pricingBasis: string;
  quantity: DecimalLike;
}

/**
 * Refuses (403) a scope-only editor's write that would change BOQ money:
 *  - the unit rate,
 *  - the pricing basis,
 *  - a lump sum's amount — which is its quantity × rate (quantity 1, rate = amount), so on a
 *    lump-sum line the quantity is money too.
 *
 * Absent fields are ignored, and a present field that equals the stored value (an unchanged echo
 * of the row) is allowed — only an actual change is refused. A create compares against an empty
 * line with the default UNIT_RATE basis.
 */
export function assertMayChangeBoqMoney(
  identity: RequestIdentity,
  proposed: ProposedMoney,
  stored: StoredMoney | null,
): void {
  if (!isScopeOnlyEditor(identity)) return;
  const before: StoredMoney = stored ?? { unitRate: null, pricingBasis: 'UNIT_RATE', quantity: null };

  const changed: string[] = [];
  if (proposed.unitRate !== undefined && !sameDecimal(proposed.unitRate, before.unitRate)) {
    changed.push('unit rate');
  }
  if (proposed.pricingBasis !== undefined && proposed.pricingBasis !== before.pricingBasis) {
    changed.push('pricing basis');
  }
  const lumpSum = (proposed.pricingBasis ?? before.pricingBasis) === 'LUMP_SUM';
  if (lumpSum && proposed.quantity !== undefined && !sameDecimal(proposed.quantity, before.quantity)) {
    changed.push('lump-sum amount');
  }

  if (changed.length > 0) {
    throw new ForbiddenException({
      errorCode: 'BOQ_COST_EDIT_FORBIDDEN',
      message: `Changing the ${changed.join(', ')} needs cost-edit rights (edit-cost:boq).`,
    });
  }
}
