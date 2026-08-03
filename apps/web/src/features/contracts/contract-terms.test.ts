import { ContractStatus, GuaranteeStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  advanceBasisOf,
  canEditTerms,
  fractionToPercent,
  isLapsed,
  isValidPercent,
  lapsedGuarantees,
  percentToFraction,
} from './contract-terms';
import type { ContractGuarantee } from './types';

describe('percentage conversion', () => {
  // Every rate on a contract is a Decimal(5,4) fraction. Sending "5" where "0.05" was
  // meant asks the client for 500% retention, which is why this has its own tests.
  it.each([
    ['0.0500', '5'],
    ['0.1000', '10'],
    ['0.0250', '2.5'],
    ['1.0000', '100'],
    ['0.0000', '0'],
  ])('reads %s back as %s%%', (fraction, percent) => {
    expect(fractionToPercent(fraction)).toBe(percent);
  });

  it.each([
    ['5', '0.0500'],
    ['10', '0.1000'],
    ['2.5', '0.0250'],
    ['100', '1.0000'],
    ['0', '0.0000'],
  ])('sends %s%% as %s', (percent, fraction) => {
    expect(percentToFraction(percent)).toBe(fraction);
  });

  // What the API actually returns. Prisma drops trailing zeros when serializing a
  // Decimal, so a rate stored from "0.0500" reads back as "0.05" and a split stored from
  // "0.5000" reads back as "0.5" — verified against the running server. Reading those as
  // 0.05% and 0.5% would understate retention by a factor of a hundred.
  it.each([
    ['0.05', '5'],
    ['0.5', '50'],
    ['0.1', '10'],
    ['1', '100'],
  ])('reads the unpadded %s the API returns as %s%%', (fraction, percent) => {
    expect(fractionToPercent(fraction)).toBe(percent);
  });

  it('round-trips without drift', () => {
    for (const percent of ['5', '10', '2.5', '7.25', '100']) {
      expect(fractionToPercent(percentToFraction(percent))).toBe(percent);
    }
  });

  it('always pads to the four decimal places the column stores', () => {
    expect(percentToFraction('5')).toHaveLength(6);
    expect(percentToFraction('12.5')).toBe('0.1250');
  });

  it('treats missing and unparseable values as empty rather than zero', () => {
    expect(fractionToPercent(null)).toBe('');
    expect(fractionToPercent(undefined)).toBe('');
    expect(fractionToPercent('')).toBe('');
    expect(fractionToPercent('not a number')).toBe('');
    expect(percentToFraction('  ')).toBe('');
    expect(percentToFraction('abc')).toBe('');
  });

  it('tolerates whitespace around a typed percentage', () => {
    expect(percentToFraction('  7.5  ')).toBe('0.0750');
  });
});

describe('isValidPercent', () => {
  it.each(['0', '5', '12.5', '100'])('accepts %s', (value) => {
    expect(isValidPercent(value)).toBe(true);
  });

  it.each(['-1', '101', 'abc', ''])('rejects %s', (value) => {
    expect(isValidPercent(value)).toBe(false);
  });
});

describe('canEditTerms', () => {
  // Retention is released at and after practical completion, so the door stays open
  // through FINAL_ACCOUNT_PENDING — that is what retentionReleasedAt is for.
  it.each([
    ContractStatus.DRAFT,
    ContractStatus.UNDER_REVIEW,
    ContractStatus.PENDING_SIGNATURE,
    ContractStatus.ACTIVE,
    ContractStatus.FINAL_ACCOUNT_PENDING,
  ])('allows editing terms while %s', (status) => {
    expect(canEditTerms(status)).toBe(true);
  });

  it.each([ContractStatus.CLOSED, ContractStatus.CANCELLED, ContractStatus.TERMINATED])(
    'locks terms once %s',
    (status) => {
      expect(canEditTerms(status)).toBe(false);
    },
  );
});

describe('advanceBasisOf', () => {
  it('reports which basis a term was priced on', () => {
    expect(advanceBasisOf({ amount: '450000.00', percentage: null })).toBe('amount');
    expect(advanceBasisOf({ amount: null, percentage: '0.1000' })).toBe('percentage');
  });

  // The DTO marks both optional and enforces no relationship, so the API accepts a term
  // with neither. Nothing downstream can price that, and the reader has to cope.
  it('reports null when the API stored a term with neither', () => {
    expect(advanceBasisOf({ amount: null, percentage: null })).toBeNull();
  });

  it('prefers the amount when the API stored both', () => {
    expect(advanceBasisOf({ amount: '1.00', percentage: '0.1000' })).toBe('amount');
  });
});

describe('guarantee expiry', () => {
  function guarantee(overrides: Partial<ContractGuarantee>): ContractGuarantee {
    return {
      id: 'g1',
      contractId: 'c1',
      guaranteeType: 'PERFORMANCE',
      amount: '450000.00',
      currency: 'USD',
      issuer: 'Salaam Bank',
      beneficiary: 'Baraka Real Estate LLC',
      issueDate: '2026-02-01T00:00:00.000Z',
      expiryDate: '2027-12-31T00:00:00.000Z',
      status: GuaranteeStatus.ACTIVE,
      notes: null,
      attachments: [],
      ...overrides,
    };
  }

  // The one case worth surfacing: the bank's obligation has lapsed while the record still
  // claims cover. Nothing on the API moves the status, so it stays ACTIVE until a human
  // changes it.
  it('flags an ACTIVE guarantee whose expiry has passed', () => {
    const g = guarantee({ expiryDate: '2026-01-01T00:00:00.000Z' });
    expect(isLapsed(g, '2026-08-04')).toBe(true);
  });

  it('does not flag one that expires today', () => {
    const g = guarantee({ expiryDate: '2026-08-04T00:00:00.000Z' });
    expect(isLapsed(g, '2026-08-04')).toBe(false);
  });

  it('does not flag one that is still in date', () => {
    expect(isLapsed(guarantee({}), '2026-08-04')).toBe(false);
  });

  it.each([GuaranteeStatus.DISCHARGED, GuaranteeStatus.EXPIRED, GuaranteeStatus.CALLED])(
    'does not flag a %s guarantee, whose ending is already recorded',
    (status) => {
      const g = guarantee({ status, expiryDate: '2026-01-01T00:00:00.000Z' });
      expect(isLapsed(g, '2026-08-04')).toBe(false);
    },
  );

  it('collects only the lapsed ones', () => {
    const lapsed = guarantee({ id: 'lapsed', expiryDate: '2026-01-01T00:00:00.000Z' });
    const current = guarantee({ id: 'current' });
    const discharged = guarantee({
      id: 'discharged',
      status: GuaranteeStatus.DISCHARGED,
      expiryDate: '2026-01-01T00:00:00.000Z',
    });

    expect(lapsedGuarantees([lapsed, current, discharged], '2026-08-04')).toEqual([lapsed]);
  });
});
