import { Decimal } from '@prisma/client/runtime/library';

import {
  VariationOrderPolicy,
  lineAmount,
  netPrice,
  deriveContractValue,
  type VariationOrderStatusValue,
} from './variation-order.policy.js';

const ALL_STATUSES: VariationOrderStatusValue[] = [
  'DRAFT',
  'PENDING_INTERNAL',
  'INTERNAL_APPROVED',
  'CLIENT_APPROVED',
  'REJECTED',
  'WITHDRAWN',
];

describe('VariationOrderPolicy — lifecycle guards (ADR-026 CONST-VAR-004)', () => {
  describe('forward transitions', () => {
    it('submit: only DRAFT → PENDING_INTERNAL', () => {
      expect(VariationOrderPolicy.evaluateTransition('DRAFT', 'submit')).toEqual({
        allowed: true,
        to: 'PENDING_INTERNAL',
      });
      for (const s of ALL_STATUSES.filter((s) => s !== 'DRAFT')) {
        expect(VariationOrderPolicy.evaluateTransition(s, 'submit').allowed).toBe(false);
      }
    });

    it('internalApprove: only PENDING_INTERNAL → INTERNAL_APPROVED', () => {
      expect(VariationOrderPolicy.evaluateTransition('PENDING_INTERNAL', 'internalApprove')).toEqual({
        allowed: true,
        to: 'INTERNAL_APPROVED',
      });
      for (const s of ALL_STATUSES.filter((s) => s !== 'PENDING_INTERNAL')) {
        expect(VariationOrderPolicy.evaluateTransition(s, 'internalApprove').allowed).toBe(false);
      }
    });

    it('clientApprove: only INTERNAL_APPROVED → CLIENT_APPROVED', () => {
      expect(VariationOrderPolicy.evaluateTransition('INTERNAL_APPROVED', 'clientApprove')).toEqual({
        allowed: true,
        to: 'CLIENT_APPROVED',
      });
      for (const s of ALL_STATUSES.filter((s) => s !== 'INTERNAL_APPROVED')) {
        expect(VariationOrderPolicy.evaluateTransition(s, 'clientApprove').allowed).toBe(false);
      }
    });
  });

  describe('reject / withdraw (any pre-client, non-terminal state)', () => {
    it.each(['DRAFT', 'PENDING_INTERNAL', 'INTERNAL_APPROVED'] as VariationOrderStatusValue[])(
      'reject is allowed from %s → REJECTED',
      (s) => {
        expect(VariationOrderPolicy.evaluateTransition(s, 'reject')).toEqual({
          allowed: true,
          to: 'REJECTED',
        });
      },
    );

    it.each(['CLIENT_APPROVED', 'REJECTED', 'WITHDRAWN'] as VariationOrderStatusValue[])(
      'reject is NOT allowed from terminal %s',
      (s) => {
        expect(VariationOrderPolicy.evaluateTransition(s, 'reject').allowed).toBe(false);
      },
    );

    it.each(['DRAFT', 'PENDING_INTERNAL', 'INTERNAL_APPROVED'] as VariationOrderStatusValue[])(
      'withdraw is allowed from %s → WITHDRAWN',
      (s) => {
        expect(VariationOrderPolicy.evaluateTransition(s, 'withdraw')).toEqual({
          allowed: true,
          to: 'WITHDRAWN',
        });
      },
    );

    it('there is no un-approve: a CLIENT_APPROVED VO cannot be withdrawn or rejected', () => {
      expect(VariationOrderPolicy.evaluateTransition('CLIENT_APPROVED', 'withdraw').allowed).toBe(false);
      expect(VariationOrderPolicy.evaluateTransition('CLIENT_APPROVED', 'reject').allowed).toBe(false);
    });
  });

  describe('field editing closes at PENDING_INTERNAL (CONST-VAR-004/-010)', () => {
    it('fields are editable ONLY while DRAFT', () => {
      expect(VariationOrderPolicy.fieldsEditable('DRAFT')).toBe(true);
      for (const s of ALL_STATUSES.filter((s) => s !== 'DRAFT')) {
        expect(VariationOrderPolicy.fieldsEditable(s)).toBe(false);
      }
    });
  });

  describe('counting toward contract value', () => {
    it('only CLIENT_APPROVED counts toward governing (CONST-VAR-005)', () => {
      for (const s of ALL_STATUSES) {
        expect(VariationOrderPolicy.countsTowardGoverning(s)).toBe(s === 'CLIENT_APPROVED');
      }
    });

    it('pending = PENDING_INTERNAL + INTERNAL_APPROVED only; excludes DRAFT and terminals (CONST-VAR-006)', () => {
      expect(VariationOrderPolicy.countsTowardPending('PENDING_INTERNAL')).toBe(true);
      expect(VariationOrderPolicy.countsTowardPending('INTERNAL_APPROVED')).toBe(true);
      expect(VariationOrderPolicy.countsTowardPending('DRAFT')).toBe(false);
      expect(VariationOrderPolicy.countsTowardPending('CLIENT_APPROVED')).toBe(false);
      expect(VariationOrderPolicy.countsTowardPending('REJECTED')).toBe(false);
      expect(VariationOrderPolicy.countsTowardPending('WITHDRAWN')).toBe(false);
    });
  });
});

describe('Variation derived-total math (ADR-026 CONST-VAR-002/-005/-006)', () => {
  it('lineAmount = quantity × unitRate at 2dp; negative quantity → omission', () => {
    expect(lineAmount({ quantity: 10, unitRate: '25.50' }).toFixed(2)).toBe('255.00');
    expect(lineAmount({ quantity: -4, unitRate: 100 }).toFixed(2)).toBe('-400.00');
  });

  it('netPrice = Σ line amounts (signed); an omission-heavy VO can be negative', () => {
    expect(netPrice([{ amount: '1000' }, { amount: '-1500' }, { amount: '200' }]).toFixed(2)).toBe(
      '-300.00',
    );
  });

  it('empty VO nets to zero', () => {
    expect(netPrice([]).toFixed(2)).toBe('0.00');
  });

  describe('deriveContractValue', () => {
    const original = new Decimal('1000000');

    it('governing = original + Σ CLIENT_APPROVED net; pending excludes DRAFT and terminals', () => {
      const figures = deriveContractValue(original, [
        { status: 'CLIENT_APPROVED', netPrice: '50000' }, // counts toward governing
        { status: 'CLIENT_APPROVED', netPrice: '-20000' }, // omission reduces governing
        { status: 'INTERNAL_APPROVED', netPrice: '30000' }, // pending
        { status: 'PENDING_INTERNAL', netPrice: '10000' }, // pending
        { status: 'DRAFT', netPrice: '99999' }, // counted nowhere
        { status: 'REJECTED', netPrice: '99999' }, // inert
        { status: 'WITHDRAWN', netPrice: '99999' }, // inert
      ]);
      expect(figures.original.toFixed(2)).toBe('1000000.00');
      expect(figures.approvedVariationsTotal.toFixed(2)).toBe('30000.00'); // 50000 - 20000
      expect(figures.governing.toFixed(2)).toBe('1030000.00');
      expect(figures.pending.toFixed(2)).toBe('40000.00'); // 30000 + 10000
    });

    it('a net omission drives governing BELOW the original', () => {
      const figures = deriveContractValue(original, [
        { status: 'CLIENT_APPROVED', netPrice: '-250000' },
      ]);
      expect(figures.governing.toFixed(2)).toBe('750000.00');
      expect(figures.pending.toFixed(2)).toBe('0.00');
    });

    it('no variations → governing = original, everything else zero', () => {
      const figures = deriveContractValue(original, []);
      expect(figures.approvedVariationsTotal.toFixed(2)).toBe('0.00');
      expect(figures.governing.toFixed(2)).toBe('1000000.00');
      expect(figures.pending.toFixed(2)).toBe('0.00');
    });

    it('pending is NEVER folded into governing (CONST-VAR-006 / -006a)', () => {
      const figures = deriveContractValue(original, [
        { status: 'INTERNAL_APPROVED', netPrice: '500000' },
      ]);
      expect(figures.governing.toFixed(2)).toBe('1000000.00'); // unchanged
      expect(figures.pending.toFixed(2)).toBe('500000.00');
    });
  });
});
