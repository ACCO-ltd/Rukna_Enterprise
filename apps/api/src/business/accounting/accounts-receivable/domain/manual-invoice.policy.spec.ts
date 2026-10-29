import { priceManualLines } from './manual-invoice.policy.js';

const line = (over: Partial<{ description: string; quantity: string; unitPrice: string; revenueAccountCode: string }> = {}) => ({
  description: 'Excavator hire — 3 days',
  quantity: '3',
  unitPrice: '450.00',
  revenueAccountCode: '42100',
  ...over,
});

describe('priceManualLines (ADR-048)', () => {
  it('prices each line to cents and totals them', () => {
    const r = priceManualLines([line(), line({ quantity: '2.5', unitPrice: '10.01' })]);
    expect(r.problems).toEqual([]);
    expect(r.lines.map((l) => l.amount.toFixed(2))).toEqual(['1350.00', '25.03']); // 25.025 → 25.03
    expect(r.subtotal.toFixed(2)).toBe('1375.03');
  });

  it('lists every problem at once', () => {
    const r = priceManualLines([line({ description: ' ', quantity: '0', unitPrice: '1.001', revenueAccountCode: '' })]);
    expect(r.problems).toEqual([
      'Line 1 needs a description.',
      'Line 1 needs an income account.',
      'Line 1 quantity must be above 0, with up to 3 decimals.',
      'Line 1 rate must be above 0, with up to 2 decimals.',
    ]);
  });

  it('needs at least one line and rejects a non-number', () => {
    expect(priceManualLines([]).problems).toEqual(['An invoice needs at least one line.']);
    expect(priceManualLines([line({ unitPrice: 'abc' })]).problems).toContain(
      'Line 1 rate must be above 0, with up to 2 decimals.',
    );
  });
});
