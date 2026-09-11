import { PERMISSIONS, type RequestIdentity } from '@erp/types';

/**
 * The single, server-owned definition of BOQ money visibility (ADR-029 §8 A-2).
 *
 * There are THREE tiers, enforced by OMITTING fields from the read-model response — never by the
 * UI. This function is the one place that maps a caller's capabilities onto the two visibility
 * booleans; both the BOQ workspace read model and the Commercial read model consume it (and R10's
 * new read models will reuse it), so the tiers can never drift between screens.
 *
 * - **Operational** (`view:boq` only): scope, quantity, unit, progress. No money.
 * - **Cost-control** (`view-cost:boq`): + line budgets, rates, amounts, cost-coding.
 * - **Commercial/Exec** (`view-margin:boq`): + contract value (base & current), contingency
 *   reserve + remaining, total client revenue, margin / contract-vs-cost.
 *
 * Implications encoded here, once:
 * - `view-margin` **implies** `view-cost` — you cannot reason about margin without seeing cost.
 * - `manage:boq` is a backward-compatible **umbrella**: a manager edits cost, so it grants the cost
 *   tier. It does NOT grant the margin tier — profitability stays a deliberate, separate grant.
 * - The legacy Commercial gate `financialPositionView` is carried onto BOTH tiers so existing
 *   finance/exec roles keep the money visibility they have today (they already saw margin figures
 *   in the Commercial workspace); this preserves current behaviour while the new caps roll out.
 */
export interface BoqVisibility {
  /** Rates, line amounts, line budgets and cost-coding may appear in the response. */
  canViewCost: boolean;
  /** Contract value, contingency reserve/remaining, total client revenue and margin may appear. */
  canViewMargin: boolean;
}

export function resolveBoqVisibility(identity: RequestIdentity): BoqVisibility {
  const has = (permission: string): boolean => identity.permissions.includes(permission);

  // Margin: the top tier. `financialPositionView` is the legacy commercial/finance gate — carried
  // over so existing finance/exec roles are not silently downgraded when the caps are introduced.
  const canViewMargin =
    has(PERMISSIONS.boqViewMargin) || has(PERMISSIONS.financialPositionView);

  // Cost: granted directly, implied by margin, or by the `manage:boq` umbrella (a manager edits
  // cost, so must see it). Also carried by the legacy commercial gate.
  const canViewCost =
    canViewMargin ||
    has(PERMISSIONS.boqViewCost) ||
    has(PERMISSIONS.boqManage) ||
    has(PERMISSIONS.financialPositionView);

  return { canViewCost, canViewMargin };
}

/**
 * ADR-029 §8 A-1 — whether the caller may perform a BOQ *edit*.
 *
 * An edit is authorized by `edit-scope:boq` OR `edit-cost:boq` OR the backward-compatible umbrella
 * `manage:boq`. This is the in-service companion to the controller guard: the route admits the
 * umbrella and either split cap, and the service confirms the same OR so a narrower client cannot
 * slip past by calling a handler whose decorator only names one of them.
 */
export function canEditBoq(identity: RequestIdentity): boolean {
  return (
    identity.permissions.includes(PERMISSIONS.boqManage) ||
    identity.permissions.includes(PERMISSIONS.boqEditScope) ||
    identity.permissions.includes(PERMISSIONS.boqEditCost)
  );
}
