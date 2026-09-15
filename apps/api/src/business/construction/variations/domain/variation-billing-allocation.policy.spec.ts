import {
  VariationBillingAllocationPolicy,
  sumAllocations,
} from './variation-billing-allocation.policy.js';

/**
 * ADR-030 CONST-COM-028 — the realization invariant, proven purely (no Prisma, no DB).
 *
 * The invariant in one line: a VO's allocations move MONOTONICALLY toward its `netValue`, on the SAME
 * side of zero as `netValue`, and NEVER overshoot it in magnitude; fully realized ⇔ Σ == netValue.
 * These cases are the "exactly once" proof — a VO dollar can be billed once and only once.
 */
describe('VariationBillingAllocationPolicy (CONST-COM-028)', () => {
  const amt = (v: string) => ({ amount: v });

  describe('sumAllocations', () => {
    it('sums signed amounts at 2dp', () => {
      expect(sumAllocations([amt('100.00'), amt('50.50'), amt('-25.25')]).toFixed(2)).toBe('125.25');
    });
    it('is zero for an empty set (an unrealized VO)', () => {
      expect(sumAllocations([]).toFixed(2)).toBe('0.00');
    });
  });

  describe('remainingUnallocated', () => {
    it('is the full net for an unrealized addition', () => {
      expect(VariationBillingAllocationPolicy.remainingUnallocated('2000.00', []).toFixed(2)).toBe(
        '2000.00',
      );
    });
    it('is the full (negative) net for an unrealized omission', () => {
      expect(VariationBillingAllocationPolicy.remainingUnallocated('-3000.00', []).toFixed(2)).toBe(
        '-3000.00',
      );
    });
    it('shrinks toward zero as an addition is realized', () => {
      expect(
        VariationBillingAllocationPolicy.remainingUnallocated('2000.00', [
          amt('1200.00'),
        ]).toFixed(2),
      ).toBe('800.00');
    });
  });

  describe('isFullyRealized', () => {
    it('is true only when Σ equals netValue exactly', () => {
      expect(
        VariationBillingAllocationPolicy.isFullyRealized('2000.00', [amt('2000.00')]),
      ).toBe(true);
      expect(
        VariationBillingAllocationPolicy.isFullyRealized('2000.00', [amt('1999.99')]),
      ).toBe(false);
    });
    it('holds symmetrically for an omission', () => {
      expect(
        VariationBillingAllocationPolicy.isFullyRealized('-3000.00', [
          amt('-1000.00'),
          amt('-2000.00'),
        ]),
      ).toBe(true);
    });
  });

  describe('validateAllocation — additions', () => {
    it('accepts a first slice within net and reports the headroom after', () => {
      const r = VariationBillingAllocationPolicy.validateAllocation('2000.00', [], '2000.00');
      expect(r.ok).toBe(true);
      expect(r.remainingBefore.toFixed(2)).toBe('2000.00');
      expect(r.remainingAfter?.toFixed(2)).toBe('0.00');
    });
    it('accepts a partial slice and leaves the remainder', () => {
      const r = VariationBillingAllocationPolicy.validateAllocation('2000.00', [], '500.00');
      expect(r.ok).toBe(true);
      expect(r.remainingAfter?.toFixed(2)).toBe('1500.00');
    });
    it('accepts a slice that exactly closes the remaining headroom', () => {
      const r = VariationBillingAllocationPolicy.validateAllocation(
        '2000.00',
        [amt('1200.00')],
        '800.00',
      );
      expect(r.ok).toBe(true);
      expect(r.remainingAfter?.toFixed(2)).toBe('0.00');
    });
    it('rejects a slice that OVERSHOOTS the net in magnitude', () => {
      const r = VariationBillingAllocationPolicy.validateAllocation('2000.00', [], '2000.01');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('OVERSHOOTS_NET');
    });
    it('rejects a slice that overshoots the REMAINING headroom after prior allocations', () => {
      const r = VariationBillingAllocationPolicy.validateAllocation(
        '2000.00',
        [amt('1900.00')],
        '200.00',
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('OVERSHOOTS_NET');
    });
    it('rejects a negative slice against a positive net (WRONG_SIGN)', () => {
      const r = VariationBillingAllocationPolicy.validateAllocation('2000.00', [], '-100.00');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('WRONG_SIGN');
    });
  });

  describe('validateAllocation — omissions (symmetric)', () => {
    it('accepts a negative slice within a negative net', () => {
      const r = VariationBillingAllocationPolicy.validateAllocation('-3000.00', [], '-1000.00');
      expect(r.ok).toBe(true);
      expect(r.remainingAfter?.toFixed(2)).toBe('-2000.00');
    });
    it('rejects a negative slice that overshoots the negative net', () => {
      const r = VariationBillingAllocationPolicy.validateAllocation('-3000.00', [], '-3000.01');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('OVERSHOOTS_NET');
    });
    it('rejects a positive slice against a negative net (WRONG_SIGN)', () => {
      const r = VariationBillingAllocationPolicy.validateAllocation('-3000.00', [], '500.00');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('WRONG_SIGN');
    });
  });

  describe('validateAllocation — exhausted / degenerate', () => {
    it('rejects any nonzero slice once the VO is fully realized (nothing left to bill)', () => {
      const r = VariationBillingAllocationPolicy.validateAllocation(
        '2000.00',
        [amt('2000.00')],
        '0.01',
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('WRONG_SIGN'); // remainingBefore is zero — no headroom in either direction
    });
    it('rejects a zero slice (realizes nothing)', () => {
      const r = VariationBillingAllocationPolicy.validateAllocation('2000.00', [], '0');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('ZERO_AMOUNT');
    });
    it('rejects any slice when netValue is zero', () => {
      const r = VariationBillingAllocationPolicy.validateAllocation('0', [], '100.00');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('WRONG_SIGN');
    });
  });

  describe('exactly-once, end to end', () => {
    it('a full set of slices sums to netValue and refuses one more cent', () => {
      const existing = [amt('800.00'), amt('700.00'), amt('500.00')]; // Σ = 2000 = net
      expect(VariationBillingAllocationPolicy.isFullyRealized('2000.00', existing)).toBe(true);
      const r = VariationBillingAllocationPolicy.validateAllocation('2000.00', existing, '0.01');
      expect(r.ok).toBe(false);
    });
  });
});
