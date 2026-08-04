import { describe, expect, it } from 'vitest';

import { grossDisagreementMinor, settlementFor } from './settlement';

describe('grossDisagreementMinor', () => {
  it('returns null when the stored total matches the item sum', () => {
    expect(grossDisagreementMinor('50000.00', '50000.00')).toBeNull();
  });

  it('reports how far the stored total overstates the items', () => {
    // The client sent a gross 500.00 higher than the lines the server priced (C1).
    expect(grossDisagreementMinor('50500.00', '50000.00')).toBe(50_000);
  });

  it('reports an understated total as a negative difference', () => {
    expect(grossDisagreementMinor('49000.00', '50000.00')).toBe(-100_000);
  });

  it('catches a one-cent disagreement', () => {
    expect(grossDisagreementMinor('50000.01', '50000.00')).toBe(1);
  });
});

describe('settlementFor', () => {
  it('reads a certificate with no allocations as unpaid', () => {
    const result = settlementFor('50000.00', 0);

    expect(result.state).toBe('UNPAID');
    expect(result.allocatedMinor).toBe(0);
    expect(result.outstandingMinor).toBe(5_000_000);
  });

  it('reads a part-paid certificate as partially paid', () => {
    const result = settlementFor('50000.00', 20000);

    expect(result.state).toBe('PARTIALLY_PAID');
    expect(result.outstandingMinor).toBe(3_000_000);
  });

  it('reads an exactly settled certificate as paid', () => {
    expect(settlementFor('50000.00', 50000).state).toBe('PAID');
  });

  /**
   * The whole reason this module exists. The API's own `status` compares against the GROSS
   * certified total, so this case — a certificate carrying retention, settled in full at its
   * net — reports PARTIALLY_PAID forever (C7, #11). Measured against `netCertified` it is
   * simply paid.
   */
  it('reads a certificate carrying retention as paid when its NET is settled', () => {
    // Gross 50,000 less 5% retention = 47,500 net. The client pays the net.
    const result = settlementFor('47500.00', 47500);

    expect(result.state).toBe('PAID');
    expect(result.outstandingMinor).toBe(0);
  });

  it('distinguishes an over-allocated certificate from a settled one', () => {
    const result = settlementFor('47500.00', 48000);

    expect(result.state).toBe('OVER_ALLOCATED');
    expect(result.outstandingMinor).toBe(-50_000);
  });

  it('does not call a zero-value certificate paid', () => {
    // Nothing was ever owed, so nothing was ever paid. Reporting PAID here would put a
    // settled badge on a certificate that certifies nothing.
    expect(settlementFor('0.00', 0).state).toBe('UNPAID');
  });

  describe('while the allocation total is unavailable', () => {
    it.each([[null], [Number.NaN], [Number.POSITIVE_INFINITY]])(
      'treats %s as nothing allocated rather than inventing a payment',
      (input) => {
        const result = settlementFor('50000.00', input);

        expect(result.state).toBe('UNPAID');
        expect(result.allocatedMinor).toBe(0);
      },
    );
  });

  describe('float handling on totalAllocated', () => {
    // The endpoint sends a JS number, not a decimal string (C8). These are the values that
    // would drift if it were kept as a float and compared directly.
    it('settles exactly on a value with cents', () => {
      expect(settlementFor('1234.56', 1234.56).state).toBe('PAID');
    });

    it('does not round a near-miss up into a settlement', () => {
      const result = settlementFor('1234.56', 1234.55);

      expect(result.state).toBe('PARTIALLY_PAID');
      expect(result.outstandingMinor).toBe(1);
    });

    it('stays exact at contract scale', () => {
      expect(settlementFor('98765432.10', 98765432.1).state).toBe('PAID');
    });
  });
});
