import { BillingModel, ContractStatus, IpaStatus, IpcStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import type { Contract } from '@/features/contracts/types';
import type { Ipa } from '@/features/ipa/types';
import type { Ipc } from '@/features/ipc/types';

import {
  allocatedMinor,
  allocationProblem,
  certificatesForClient,
  fromMinorUnits,
  isFullyAllocated,
  toMinorUnits,
  unallocatedMinor,
} from './allocation';
import type { ReceiptAllocation } from './types';

function allocation(amount: string, certificateId = 'cert1'): ReceiptAllocation {
  return {
    id: `alloc-${amount}-${certificateId}`,
    receiptId: 'r1',
    certificateId,
    allocatedAmount: amount,
    allocatedAt: '2026-06-20T00:00:00.000Z',
    allocatedBy: 'u1',
  };
}

describe('minor-unit conversion', () => {
  it.each([
    ['1234.50', 123450],
    ['1234.5', 123450],
    ['1234', 123400],
    ['0.01', 1],
    ['0', 0],
    ['  99.99  ', 9999],
  ])('reads %s as %i cents', (input, expected) => {
    expect(toMinorUnits(input)).toBe(expected);
  });

  // Prisma drops trailing zeros, so the API really does send "1234.5" for 1234.50.
  it('handles the unpadded decimals the API returns', () => {
    expect(toMinorUnits('7560.5')).toBe(756050);
  });

  it('truncates beyond two places rather than rounding up into a cent', () => {
    expect(toMinorUnits('1.999')).toBe(199);
  });

  it('treats missing values as zero', () => {
    expect(toMinorUnits(null)).toBe(0);
    expect(toMinorUnits(undefined)).toBe(0);
    expect(toMinorUnits('')).toBe(0);
  });

  it.each([
    [123450, '1234.50'],
    [1, '0.01'],
    [0, '0.00'],
    [100, '1.00'],
  ])('writes %i cents as %s', (input, expected) => {
    expect(fromMinorUnits(input)).toBe(expected);
  });

  it('round-trips without drift', () => {
    for (const value of ['0.01', '1234.50', '999999.99', '7560.00']) {
      expect(fromMinorUnits(toMinorUnits(value))).toBe(
        value.includes('.') ? value.padEnd(value.indexOf('.') + 3, '0') : `${value}.00`,
      );
    }
  });

  // The reason this module exists rather than using Number arithmetic directly.
  it('sums cleanly where floating point would not', () => {
    const allocations = [allocation('0.10'), allocation('0.20')];
    expect(allocatedMinor(allocations)).toBe(30);
    expect(fromMinorUnits(allocatedMinor(allocations))).toBe('0.30');
    // The floating-point equivalent, for contrast:
    expect(0.1 + 0.2).not.toBe(0.3);
  });
});

describe('unallocated balance', () => {
  it('is the full amount when nothing is allocated', () => {
    expect(unallocatedMinor('1000.00', [])).toBe(100000);
  });

  it('subtracts every allocation', () => {
    expect(unallocatedMinor('1000.00', [allocation('250.00'), allocation('300.50')])).toBe(44950);
  });

  it('reaches exactly zero when fully applied', () => {
    const allocations = [allocation('600.00'), allocation('400.00')];
    expect(unallocatedMinor('1000.00', allocations)).toBe(0);
    expect(isFullyAllocated('1000.00', allocations)).toBe(true);
  });

  it('does not report a partly-applied receipt as fully allocated', () => {
    expect(isFullyAllocated('1000.00', [allocation('999.99')])).toBe(false);
  });
});

describe('allocationProblem', () => {
  const amount = '1000.00';

  it('accepts an amount within the remaining balance', () => {
    expect(allocationProblem('500.00', amount, [])).toBeNull();
  });

  it('accepts exactly the remaining balance', () => {
    expect(allocationProblem('400.00', amount, [allocation('600.00')])).toBeNull();
  });

  it('rejects one cent over', () => {
    expect(allocationProblem('400.01', amount, [allocation('600.00')])).toBe('exceeds-balance');
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'not-a-number'],
    ['0', 'not-positive'],
    ['0.00', 'not-positive'],
  ])('rejects %s as %s', (typed, problem) => {
    expect(allocationProblem(typed, amount, [])).toBe(problem);
  });

  // The API accepts this: @IsDecimal() permits a negative, and the server's guard only
  // checks the upper bound — so a negative allocation would pass and quietly INCREASE the
  // receipt's unallocated balance.
  it('rejects a negative allocation the API would accept', () => {
    expect(allocationProblem('-100.00', amount, [])).toBe('not-positive');
  });
});

describe('certificatesForClient', () => {
  const contract = (id: string, clientId: string): Contract => ({
    id,
    projectId: 'p1',
    organizationId: 'org1',
    clientId,
    boqVersionId: 'v1',
    contractNumber: `ACCO-${id}`,
    contractValue: '1000000.00',
    currency: 'USD',
    billingModel: BillingModel.MEASURED_IPC,
    status: ContractStatus.ACTIVE,
    clientNameSnapshot: null,
    clientTaxSnapshot: null,
    startDate: null,
    expectedEndDate: null,
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const application = (id: string, contractId: string): Ipa => ({
    id,
    contractId,
    organizationId: 'org1',
    applicationNumber: 1,
    applicationRef: 'IPA-001',
    status: IpaStatus.SUBMITTED,
    periodFrom: null,
    periodTo: null,
    submittedAt: null,
    submittedBy: null,
    exchangeRateCurrency: null,
    exchangeRateBase: null,
    exchangeRateValue: null,
    exchangeRateDate: null,
    notes: null,
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const certificate = (id: string, applicationId: string, isEffective = true): Ipc => ({
    id,
    applicationId,
    organizationId: 'org1',
    certificateNumber: 1,
    certificateRef: 'IPC-001',
    status: IpcStatus.CERTIFIED,
    isEffective,
    effectiveAt: null,
    supersededAt: null,
    supersededById: null,
    supersessionReason: null,
    certifiedTotal: '100000.00',
    currency: 'USD',
    exchangeRateCurrency: null,
    exchangeRateBase: null,
    exchangeRateValue: null,
    exchangeRateDate: null,
    issuedAt: null,
    issuedBy: null,
    notes: null,
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  const contracts = [contract('c1', 'client-a'), contract('c2', 'client-b')];
  const applications = [application('a1', 'c1'), application('a2', 'c2')];
  const certificates = [certificate('cert1', 'a1'), certificate('cert2', 'a2')];

  // The three-hop join: certificate → application → contract → client. There is no
  // endpoint that does this, which is C16.
  it('returns only certificates whose contract belongs to the client', () => {
    const options = certificatesForClient(certificates, applications, contracts, 'client-a');
    expect(options.map((o) => o.certificate.id)).toEqual(['cert1']);
    expect(options[0]?.contract.contractNumber).toBe('ACCO-c1');
  });

  // Exactly one certificate per application is effective. Allocating against a superseded
  // one records money against a document the client no longer owes on.
  it('excludes superseded certificates', () => {
    const withSuperseded = [...certificates, certificate('cert3', 'a1', false)];
    const options = certificatesForClient(withSuperseded, applications, contracts, 'client-a');
    expect(options.map((o) => o.certificate.id)).toEqual(['cert1']);
  });

  it('reports how much of this receipt is already on each certificate', () => {
    const options = certificatesForClient(certificates, applications, contracts, 'client-a', [
      allocation('250.00', 'cert1'),
      allocation('100.00', 'cert1'),
    ]);
    expect(options[0]?.allocatedFromThisReceipt).toBe(35000);
  });

  it('drops a certificate whose application or contract is missing rather than crashing', () => {
    const orphan = certificate('orphan', 'missing-application');
    const options = certificatesForClient([orphan], applications, contracts, 'client-a');
    expect(options).toEqual([]);
  });

  it('returns nothing for a client with no contracts', () => {
    expect(certificatesForClient(certificates, applications, contracts, 'client-z')).toEqual([]);
  });
});
