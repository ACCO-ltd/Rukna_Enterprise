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
  remainingCommitments: Decimal;
  actualCost: Decimal;
}

export interface FinancialPosition extends FinancialPositionInputs {
  outstandingReceivables: Decimal;
  forecastCost: Decimal;
  forecastMargin: Decimal;
}

/** FP-01 through FP-09. All amounts are USD (single-currency, ADR-024). */
export function calculateFinancialPosition(input: FinancialPositionInputs): FinancialPosition {
  return {
    ...input,
    outstandingReceivables: input.invoicedRevenue.minus(input.postedReceiptAllocations),
    forecastCost: input.actualCost.plus(input.remainingCommitments),
    forecastMargin: input.contractValue.minus(input.actualCost).minus(input.remainingCommitments),
  };
}

