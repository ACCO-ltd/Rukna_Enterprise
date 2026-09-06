import { Decimal } from '@prisma/client/runtime/library';
import {
  calculateFinancialPosition,
  FINANCIAL_POSITION_IPC_STATUSES,
  FINANCIAL_POSITION_PROJECT_STATUSES,
} from './financial-position.policy.js';

const d = (value: string) => new Decimal(value);

/** The revenue half, held constant while the cost half is exercised. */
const revenue = {
  contractValue: d('1000'),
  certifiedRevenue: d('700'),
  invoicedRevenue: d('600'),
  cashReceived: d('250'),
  postedReceiptAllocations: d('225'),
};

describe('Financial Position policy', () => {
  it('locks the confirmed project and IPC scopes', () => {
    expect(FINANCIAL_POSITION_PROJECT_STATUSES).toEqual(['ACTIVE', 'SUSPENDED', 'CLOSEOUT']);
    expect(FINANCIAL_POSITION_IPC_STATUSES).toEqual(['CERTIFIED', 'PARTIALLY_CERTIFIED']);
  });

  it('FP-05: outstanding receivables are invoiced less posted allocations', () => {
    const result = calculateFinancialPosition({
      ...revenue,
      openCommitment: d('120'),
      accruedCost: d('60'),
      actualCost: d('420'),
      budgetTotal: d('900'),
    });

    expect(result.outstandingReceivables.toString()).toBe('375');
  });

  it('committedToDate sums the three ledger stages', () => {
    const result = calculateFinancialPosition({
      ...revenue,
      openCommitment: d('120'),
      accruedCost: d('60'),
      actualCost: d('420'),
      budgetTotal: d('900'),
    });

    expect(result.committedToDate.toString()).toBe('600');
    expect(result.uncommittedBudget?.toString()).toBe('300');
  });

  /**
   * The defect this replaces: `uncommittedBudget` was `budget − COMMITTED`, and COMMITTED
   * is a signed running balance that goods receipt reduces. Receiving what you ordered
   * therefore *returned* the headroom you had already spent.
   */
  it('does not release budget headroom as an order moves through its stages', () => {
    const budgetTotal = d('1000');
    const ordered = d('400');

    const afterOrder = calculateFinancialPosition({
      ...revenue,
      openCommitment: ordered,
      accruedCost: d('0'),
      actualCost: d('0'),
      budgetTotal,
    });
    // Goods received: COMMITTED falls to zero, ACCRUED takes it up.
    const afterReceipt = calculateFinancialPosition({
      ...revenue,
      openCommitment: d('0'),
      accruedCost: ordered,
      actualCost: d('0'),
      budgetTotal,
    });
    // Billed and posted: ACCRUED released, ACTUAL carries it.
    const afterBill = calculateFinancialPosition({
      ...revenue,
      openCommitment: d('0'),
      accruedCost: d('0'),
      actualCost: ordered,
      budgetTotal,
    });

    expect(afterOrder.uncommittedBudget?.toString()).toBe('600');
    expect(afterReceipt.uncommittedBudget?.toString()).toBe('600');
    expect(afterBill.uncommittedBudget?.toString()).toBe('600');
  });

  it('reports no budget headroom at all when nothing is baselined — never zero', () => {
    const result = calculateFinancialPosition({
      ...revenue,
      openCommitment: d('120'),
      accruedCost: d('60'),
      actualCost: d('420'),
      budgetTotal: null,
    });

    expect(result.uncommittedBudget).toBeNull();
    // Cost is still real without a budget; only the ratio against it is absent.
    expect(result.committedToDate.toString()).toBe('600');
  });

  it('exposes no forecast of any kind', () => {
    const result = calculateFinancialPosition({
      ...revenue,
      openCommitment: d('120'),
      accruedCost: d('60'),
      actualCost: d('420'),
      budgetTotal: d('900'),
    });

    expect(result).not.toHaveProperty('forecastCost');
    expect(result).not.toHaveProperty('forecastMargin');
  });
});
