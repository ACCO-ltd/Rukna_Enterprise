import { Decimal } from '@prisma/client/runtime/library';

import { splitAwardAcrossLines, validateManualLines } from './order-split.policy.js';
import { slaTone, waitingMinutes } from './quotation-sla.policy.js';

const d = (v: string | number) => new Decimal(v);

describe('order split policy (ADR-044 §8)', () => {
  it('ESTIMATE: three priced lines — Σ unitPrice × qty ≤ total, shortfall < Σ qty × 0.0001', () => {
    const lines = [
      { id: 'l1', quantity: d(50), estimatedUnitPrice: d('22.10') },
      { id: 'l2', quantity: d(40), estimatedUnitPrice: d('23.45') },
      { id: 'l3', quantity: d(7), estimatedUnitPrice: d('31.333') },
    ];
    const total = d('2295.00');
    const split = splitAwardAcrossLines(total, lines);
    expect(split.mode).toBe('ESTIMATE');
    const ordered = split.lines.reduce((s, l) => s.add(l.unitPrice!.mul(l.quantity)), d(0));
    expect(ordered.lessThanOrEqualTo(total)).toBe(true);
    expect(total.sub(ordered).lessThan(d(97).mul('0.0001'))).toBe(true);
    for (const l of split.lines) expect(l.unitPrice!.decimalPlaces()).toBeLessThanOrEqual(4);
    // Amounts follow the estimate shares and never exceed the total.
    const amounts = split.lines.reduce((s, l) => s.add(l.amount!), d(0));
    expect(amounts.lessThanOrEqualTo(total)).toBe(true);
    expect(split.lines[0].amount!.greaterThan(split.lines[2].amount!)).toBe(true);
  });

  it('review L1: amounts sit on the 2-dp grid and sum to the total; stored line amounts never exceed it', () => {
    const total = d('1.00');
    const split = splitAwardAcrossLines(total, [
      { id: 'a', quantity: d(1), estimatedUnitPrice: d('0.505') },
      { id: 'b', quantity: d(1), estimatedUnitPrice: d('0.495') },
    ]);
    expect(split.lines.map((l) => l.amount!.toFixed(2))).toEqual(['0.50', '0.50']);
    // extendedAmount is stored Decimal(18,2), rounded half-up — the sum must stay within the award.
    const stored = split.lines.reduce((sum, l) => sum.add(l.unitPrice!.mul(l.quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)), d(0));
    expect(stored.lessThanOrEqualTo(total)).toBe(true);
    expect(split.lines.reduce((sum, l) => sum.add(l.amount!), d(0)).toFixed(2)).toBe('1.00');
  });

  it('SINGLE_LINE: one line takes the whole total exactly', () => {
    const split = splitAwardAcrossLines(d('918.00'), [{ id: 'l1', quantity: d(40), estimatedUnitPrice: null }]);
    expect(split.mode).toBe('SINGLE_LINE');
    expect(split.lines[0].amount!.toFixed(2)).toBe('918.00');
    expect(split.lines[0].unitPrice!.toFixed(4)).toBe('22.9500');
  });

  it('SINGLE_LINE rounds the unit price down when the total does not divide', () => {
    const split = splitAwardAcrossLines(d('100.00'), [{ id: 'l1', quantity: d(3), estimatedUnitPrice: d(1) }]);
    expect(split.lines[0].unitPrice!.toFixed(4)).toBe('33.3333');
    expect(split.lines[0].unitPrice!.mul(3).lessThanOrEqualTo(d(100))).toBe(true);
  });

  it('MANUAL: several lines with one unpriced (or all-zero estimates)', () => {
    const unpriced = splitAwardAcrossLines(d(500), [
      { id: 'l1', quantity: d(5), estimatedUnitPrice: d(10) },
      { id: 'l2', quantity: d(5), estimatedUnitPrice: null },
    ]);
    expect(unpriced.mode).toBe('MANUAL');
    expect(unpriced.lines.every((l) => l.amount === null && l.unitPrice === null)).toBe(true);
    expect(
      splitAwardAcrossLines(d(500), [
        { id: 'l1', quantity: d(5), estimatedUnitPrice: d(0) },
        { id: 'l2', quantity: d(5), estimatedUnitPrice: d(0) },
      ]).mode,
    ).toBe('MANUAL');
  });

  describe('validateManualLines', () => {
    const remaining = new Map([
      ['l1', d(50)],
      ['l2', d(40)],
    ]);
    const line = (id: string, qty: number, amount: string) => ({
      materialRequestLineId: id,
      quantity: d(qty),
      amount: d(amount),
    });

    it('accepts lines within the award, including a dropped line', () => {
      expect(validateManualLines(d('2295'), [line('l1', 50, '1147.50'), line('l2', 40, '918.00')], remaining)).toBeNull();
      expect(validateManualLines(d('2295'), [line('l1', 10, '200')], remaining)).toBeNull();
    });

    it('refuses over the cap, foreign or duplicated lines, bad quantities and amounts', () => {
      expect(validateManualLines(d('100'), [line('l1', 5, '60'), line('l2', 5, '40.01')], remaining)).toBe('PO_EXCEEDS_AWARD');
      expect(validateManualLines(d('100'), [line('other', 1, '10')], remaining)).toBe('ORDER_LINE_NOT_ON_REQUEST');
      expect(validateManualLines(d('100'), [line('l1', 1, '10'), line('l1', 1, '10')], remaining)).toBe('ORDER_LINE_DUPLICATED');
      expect(validateManualLines(d('100'), [line('l1', 51, '10')], remaining)).toBe('ORDER_LINE_QUANTITY_INVALID');
      expect(validateManualLines(d('100'), [line('l1', 0, '10')], remaining)).toBe('ORDER_LINE_QUANTITY_INVALID');
      expect(validateManualLines(d('100'), [line('l1', 1, '0')], remaining)).toBe('ORDER_LINE_AMOUNT_INVALID');
      expect(validateManualLines(d('100'), [line('l1', 1, '1.005')], remaining)).toBe('ORDER_LINE_AMOUNT_INVALID');
      expect(validateManualLines(d('100'), [], remaining)).toBe('ORDER_LINES_REQUIRED');
    });
  });
});

describe('quotation SLA policy (ADR-044 §10)', () => {
  // Mogadishu is UTC+3: local 07:00 = 04:00Z. 2026-10-08 is a Thursday, 2026-10-09 a Friday.
  const at = (iso: string) => new Date(iso);

  it('Thu 16:30 → Sat 07:30 local is 60 working minutes (Friday ignored)', () => {
    expect(waitingMinutes(at('2026-10-08T13:30:00Z'), at('2026-10-10T04:30:00Z'))).toBe(60);
  });

  it('counts only 07:00–17:00 within a working day', () => {
    // Sat 06:00 → Sat 18:00 local = the full 10-hour day.
    expect(waitingMinutes(at('2026-10-10T03:00:00Z'), at('2026-10-10T15:00:00Z'))).toBe(600);
    // Sat 10:00 → Sun 09:00 local = 7 h + 2 h.
    expect(waitingMinutes(at('2026-10-10T07:00:00Z'), at('2026-10-11T06:00:00Z'))).toBe(540);
  });

  it('a request sent on Friday starts counting at Saturday 07:00', () => {
    expect(waitingMinutes(at('2026-10-09T08:00:00Z'), at('2026-10-10T05:00:00Z'))).toBe(60);
  });

  it('urgent counts clock minutes, Friday and night included', () => {
    expect(waitingMinutes(at('2026-10-08T13:30:00Z'), at('2026-10-10T04:30:00Z'), { urgent: true })).toBe(39 * 60);
  });

  it('never negative', () => {
    expect(waitingMinutes(at('2026-10-10T05:00:00Z'), at('2026-10-10T04:00:00Z'))).toBe(0);
  });

  it('tone boundaries: 119 none, 120 amber, 239 amber, 240 red', () => {
    expect(slaTone(0)).toBe('none');
    expect(slaTone(119)).toBe('none');
    expect(slaTone(120)).toBe('amber');
    expect(slaTone(239)).toBe('amber');
    expect(slaTone(240)).toBe('red');
  });
});
