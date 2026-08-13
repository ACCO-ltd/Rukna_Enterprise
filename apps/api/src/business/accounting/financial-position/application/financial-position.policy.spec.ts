import { Decimal } from '@prisma/client/runtime/library';
import {
  calculateFinancialPosition,
  FINANCIAL_POSITION_IPC_STATUSES,
  FINANCIAL_POSITION_PROJECT_STATUSES,
  toReportingAmount,
} from './financial-position.policy.js';

const d = (value: string) => new Decimal(value);

describe('Financial Position policy', () => {
  it('locks the confirmed project and IPC scopes', () => {
    expect(FINANCIAL_POSITION_PROJECT_STATUSES).toEqual(['ACTIVE', 'SUSPENDED', 'CLOSEOUT']);
    expect(FINANCIAL_POSITION_IPC_STATUSES).toEqual(['CERTIFIED', 'PARTIALLY_CERTIFIED']);
  });

  it('calculates FP-05, FP-08, and FP-09 from authoritative inputs', () => {
    const result = calculateFinancialPosition({
      contractValue: d('1000'),
      certifiedRevenue: d('700'),
      invoicedRevenue: d('600'),
      cashReceived: d('250'),
      postedReceiptAllocations: d('225'),
      remainingCommitments: d('180'),
      actualCost: d('420'),
    });

    expect(result.outstandingReceivables.toString()).toBe('375');
    expect(result.forecastCost.toString()).toBe('600');
    expect(result.forecastMargin.toString()).toBe('400');
  });

  it('requires a positive approved exchange-rate snapshot', () => {
    expect(() => toReportingAmount(d('100'), d('0'))).toThrow(
      'APPROVED_EXCHANGE_RATE_SNAPSHOT_REQUIRED',
    );
    expect(toReportingAmount(d('100'), d('1.25')).toString()).toBe('125');
  });
});
