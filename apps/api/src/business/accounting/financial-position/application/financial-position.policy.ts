import { Decimal } from '@prisma/client/runtime/library';

export const FINANCIAL_POSITION_PROJECT_STATUSES = [
  'ACTIVE',
  'SUSPENDED',
  'CLOSEOUT',
] as const;

export const FINANCIAL_POSITION_IPC_STATUSES = [
  'CERTIFIED',
  'PARTIALLY_CERTIFIED',
] as const;

export const FINANCIAL_POSITION_POSTING_STATUS = 'POSTED' as const;
export const FINANCIAL_POSITION_MAIN_CONTRACT_KIND = 'CLIENT_CONTRACT' as const;

export interface FinancialPositionInputs {
  contractValue: Decimal;
  certifiedRevenue: Decimal;
  invoicedRevenue: Decimal;
  cashReceived: Decimal;
  postedReceiptAllocations: Decimal;
  /** Commitment-ledger COMMITTED: ordered and not yet received. */
  openCommitment: Decimal;
  /** Commitment-ledger ACCRUED: received and not yet billed. */
  accruedCost: Decimal;
  /** Posted GL cost carrying this project's id. */
  actualCost: Decimal;
  /** Total of the BASELINED cost budget, or null when the project has never set one. */
  budgetTotal: Decimal | null;
}

export interface FinancialPosition extends FinancialPositionInputs {
  outstandingReceivables: Decimal;
  /**
   * Everything the project has either spent or contractually committed to spend.
   *
   * The three ledger stages sum to this without double-counting, because each stage
   * transition reverses the previous one: a purchase order raises COMMITTED, goods
   * receipt moves it to ACCRUED, and a posted bill moves that to ACTUAL. At every
   * point the three add up to what has been ordered.
   */
  committedToDate: Decimal;
  /**
   * Budget still free to spend. Null without a baselined budget — a project that has
   * set no budget has not got 100% of it left.
   *
   * Measured against `committedToDate`, never against COMMITTED alone. COMMITTED is a
   * signed running balance that falls when goods arrive, so subtracting it made budget
   * headroom *rise* on every goods receipt: budget 1 000 with a 400 order fully
   * received reported the full 1 000 as still available.
   */
  uncommittedBudget: Decimal | null;
}

/**
 * FP-01 through FP-09. All amounts are USD (single-currency, ADR-024).
 *
 * There is deliberately no forecast here. `forecastCost` used to be
 * `actual + committed + accrued` and `forecastMargin` was `contractValue` minus that —
 * neither contained any estimate of the cost still to come, so a project with no open
 * purchase orders reported cost-at-completion equal to cost-to-date and a margin equal
 * to the whole contract. The error could only ever run one way: understate cost,
 * overstate margin, and most severely at the start of a job. A real forecast needs
 * remaining scope valued at a cost rate, and the platform has no cost rates yet
 * (BOQ rates are sell rates). Until it does, this reports what is known.
 */
export function calculateFinancialPosition(input: FinancialPositionInputs): FinancialPosition {
  const committedToDate = input.openCommitment.plus(input.accruedCost).plus(input.actualCost);

  return {
    ...input,
    outstandingReceivables: input.invoicedRevenue.minus(input.postedReceiptAllocations),
    committedToDate,
    uncommittedBudget:
      input.budgetTotal === null ? null : input.budgetTotal.minus(committedToDate),
  };
}
