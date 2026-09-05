import { Decimal } from '@prisma/client/runtime/library';

import type {
  ProjectCostByBoqRow,
  ProjectCostPosition,
  ProjectCostStage,
} from '@erp/types';

/**
 * Pure cost arithmetic for the project procurement read model.
 *
 * Separated from the service because these are the rules that must not go wrong, and a rule with
 * no database behind it is one that can be tested exhaustively. Nothing here reads or writes;
 * everything takes ledger totals and a budget and returns what a screen should show.
 */

export const ZERO = new Decimal(0);

export interface StageTotals {
  committed: Decimal;
  accrued: Decimal;
  actual: Decimal;
}

export function emptyStageTotals(): StageTotals {
  return { committed: ZERO, accrued: ZERO, actual: ZERO };
}

export function addStage(totals: StageTotals, stage: ProjectCostStage, amount: Decimal): void {
  if (stage === 'COMMITTED') totals.committed = totals.committed.plus(amount);
  else if (stage === 'ACCRUED') totals.accrued = totals.accrued.plus(amount);
  else totals.actual = totals.actual.plus(amount);
}

/**
 * A percentage of budget, or null when there is nothing to be a percentage of.
 *
 * Null rather than 0 is the whole point: a project with no budget set has not spent 0% of it,
 * and a screen showing "0.0% of budget" on every card invents a control that does not exist.
 */
export function percentOf(amount: Decimal, budget: Decimal | null): number | null {
  if (budget === null || budget.lte(ZERO)) return null;
  return Math.round(amount.div(budget).mul(1000).toNumber()) / 10;
}

/**
 * The headline position.
 *
 * `forecastExposure` is committed minus actual — cost already promised to suppliers that has not
 * yet landed as a bill. It is floored at zero: a negative would mean more has been billed than
 * committed, which is a data problem to investigate rather than a negative exposure to report.
 */
export function buildPosition(
  totals: StageTotals,
  budgetTotal: Decimal | null,
  currency: string | null,
  mayViewFinancials: boolean,
): ProjectCostPosition {
  const exposure = Decimal.max(ZERO, totals.committed.minus(totals.actual));
  const money = (d: Decimal): string | null => (mayViewFinancials ? d.toFixed(2) : null);

  return {
    currency,
    committed: money(totals.committed),
    accrued: money(totals.accrued),
    actual: money(totals.actual),
    forecastExposure: money(exposure),
    budgetTotal: mayViewFinancials && budgetTotal !== null ? budgetTotal.toFixed(2) : null,
    committedPercentOfBudget: mayViewFinancials ? percentOf(totals.committed, budgetTotal) : null,
    accruedPercentOfBudget: mayViewFinancials ? percentOf(totals.accrued, budgetTotal) : null,
    actualPercentOfBudget: mayViewFinancials ? percentOf(totals.actual, budgetTotal) : null,
    forecastExposurePercentOfBudget: mayViewFinancials ? percentOf(exposure, budgetTotal) : null,
  };
}

export interface BoqNodeShape {
  id: string;
  parentId: string | null;
  code: string;
  description: string;
  depth: number;
  sortOrder: number;
  isLeaf: boolean;
}

/**
 * Roll leaf-coded cost up the BOQ hierarchy into a readable tree.
 *
 * Cost is coded to leaves — that is what `PurchaseOrderLine.boqNodeId` points at — but a
 * 400-line cost report is not a report, it is a data dump. Every node therefore carries the sum
 * of itself and everything beneath it, so a reader opens at section level and expands only where
 * the money went.
 *
 * The project-level bucket (`boqNodeId = null`) is appended as a peer of the top-level sections,
 * not hidden and not folded into one of them. It is real project cost — site office, transport,
 * insurance — that simply has no priced scope to trace to. Cost with no *project* never arrives
 * here at all; that is corporate overhead and belongs to neither.
 */
export function rollUpCostByBoq(options: {
  nodes: BoqNodeShape[];
  costByNode: Map<string | null, StageTotals>;
  budgetByNode: Map<string | null, Decimal>;
  projectLevelLabel: string;
  mayViewFinancials: boolean;
}): ProjectCostByBoqRow[] {
  const { nodes, costByNode, budgetByNode, projectLevelLabel, mayViewFinancials } = options;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string | null, BoqNodeShape[]>();
  for (const node of nodes) {
    const siblings = childrenOf.get(node.parentId) ?? [];
    siblings.push(node);
    childrenOf.set(node.parentId, siblings);
  }

  // Accumulate each node's own cost, then push it up every ancestor. One pass per coded node
  // rather than a walk per ancestor, so a deep tree does not become quadratic.
  const rolled = new Map<string, StageTotals>();
  const rolledBudget = new Map<string, Decimal>();
  const bump = (id: string, totals: StageTotals) => {
    const current = rolled.get(id) ?? emptyStageTotals();
    current.committed = current.committed.plus(totals.committed);
    current.accrued = current.accrued.plus(totals.accrued);
    current.actual = current.actual.plus(totals.actual);
    rolled.set(id, current);
  };

  for (const [nodeId, totals] of costByNode) {
    if (nodeId === null) continue;
    let cursor: string | null = nodeId;
    while (cursor) {
      bump(cursor, totals);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }
  for (const [nodeId, amount] of budgetByNode) {
    if (nodeId === null) continue;
    let cursor: string | null = nodeId;
    while (cursor) {
      rolledBudget.set(cursor, (rolledBudget.get(cursor) ?? ZERO).plus(amount));
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }

  const rows: ProjectCostByBoqRow[] = [];
  const money = (d: Decimal | null): string | null =>
    !mayViewFinancials || d === null ? null : d.toFixed(2);

  const visit = (node: BoqNodeShape) => {
    const totals = rolled.get(node.id);
    const budget = rolledBudget.get(node.id) ?? null;
    // A node with neither cost nor budget is scope nobody has spent against. Including it would
    // bury the five sections that matter under three hundred that do not.
    if (!totals && budget === null) return;

    const committed = totals?.committed ?? ZERO;
    rows.push({
      kind: 'BOQ',
      boqNodeId: node.id,
      code: node.code,
      description: node.description,
      depth: node.depth,
      hasChildren: (childrenOf.get(node.id) ?? []).length > 0,
      budget: money(budget),
      committed: money(committed),
      accrued: money(totals?.accrued ?? ZERO),
      actual: money(totals?.actual ?? ZERO),
      remaining: budget === null ? null : money(budget.minus(committed)),
      percentUsed: mayViewFinancials ? percentOf(committed, budget) : null,
    });

    for (const child of childrenOf.get(node.id) ?? []) visit(child);
  };

  for (const root of childrenOf.get(null) ?? []) visit(root);

  const projectLevelCost = costByNode.get(null);
  const projectLevelBudget = budgetByNode.get(null) ?? null;
  if (projectLevelCost || projectLevelBudget !== null) {
    const committed = projectLevelCost?.committed ?? ZERO;
    rows.push({
      kind: 'PROJECT_LEVEL',
      boqNodeId: null,
      code: null,
      description: projectLevelLabel,
      depth: 0,
      hasChildren: false,
      budget: money(projectLevelBudget),
      committed: money(committed),
      accrued: money(projectLevelCost?.accrued ?? ZERO),
      actual: money(projectLevelCost?.actual ?? ZERO),
      remaining: projectLevelBudget === null ? null : money(projectLevelBudget.minus(committed)),
      percentUsed: mayViewFinancials ? percentOf(committed, projectLevelBudget) : null,
    });
  }

  return rows;
}
