import { agingBucket, daysPastDue, monthBounds } from './aging.js';

describe('Finance Home aging (Step 4)', () => {
  it('counts whole days past due, ignoring the time of day', () => {
    expect(daysPastDue(new Date('2026-10-01'), new Date('2026-10-28T23:00:00Z'))).toBe(27);
    expect(daysPastDue(new Date('2026-10-30'), new Date('2026-10-28'))).toBe(-2);
  });

  it('puts each invoice in one bucket at the edges', () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(agingBucket)).toEqual([
      'current', 'd1_30', 'd1_30', 'd31_60', 'd31_60', 'd61_90', 'd61_90', 'd90_plus',
    ]);
  });

  it('knows the month, February included', () => {
    const { from, to } = monthBounds(new Date('2027-02-14'));
    expect(from.toISOString().slice(0, 10)).toBe('2027-02-01');
    expect(to.toISOString().slice(0, 10)).toBe('2027-02-28');
  });
});
