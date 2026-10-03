import { Decimal } from '@prisma/client/runtime/library';
import type { ProjectAccountingPosition } from '@erp/types';

/**
 * Posted revenue and cost for the project — shared by the project Finance Overview and the
 * Finance portfolio (ADR-043), so the margin is one formula.
 *
 * When the ledger cannot accept a posting at all, every figure is null rather than zero: a
 * project whose accounting was never configured has not earned nothing, and the two states
 * must not look the same on screen.
 */
export function buildAccountingPosition(
  ready: boolean,
  blockers: ProjectAccountingPosition['blockers'],
  revenue: Decimal,
  projectCost: Decimal,
  mayViewFinancials: boolean,
): ProjectAccountingPosition {
  if (!ready || !mayViewFinancials) {
    return {
      available: false,
      revenue: null,
      projectCost: null,
      grossProfit: null,
      marginPercent: null,
      blockers: ready ? [] : blockers,
    };
  }

  const grossProfit = revenue.minus(projectCost);
  return {
    available: true,
    revenue: revenue.toFixed(2),
    projectCost: projectCost.toFixed(2),
    grossProfit: grossProfit.toFixed(2),
    // No revenue means no denominator. A margin of 0% would claim the project broke even.
    marginPercent: revenue.greaterThan(0)
      ? Math.round(grossProfit.div(revenue).mul(1000).toNumber()) / 10
      : null,
    blockers: [],
  };
}
