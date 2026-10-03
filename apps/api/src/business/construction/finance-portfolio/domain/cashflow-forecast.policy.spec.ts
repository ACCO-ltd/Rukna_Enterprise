import { Decimal } from '@prisma/client/runtime/library';

import {
  MAX_PERIODS,
  buildForecast,
  buildGrid,
  bucketKeyFor,
  expectedBillDate,
  expectedCommitmentPayDate,
  periodStart,
  type CashflowItem,
} from './cashflow-forecast.policy';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
// Wednesday 2026-10-07.
const TODAY = new Date('2026-10-07T09:30:00Z');

describe('cash-flow forecast policy (ADR-043 Phase 4)', () => {
  describe('periods', () => {
    it('starts a week on Monday and a month on the 1st (UTC)', () => {
      expect(periodStart(TODAY, 'WEEK').toISOString().slice(0, 10)).toBe('2026-10-05');
      expect(periodStart(d('2026-10-11'), 'WEEK').toISOString().slice(0, 10)).toBe('2026-10-05'); // Sunday
      expect(periodStart(TODAY, 'MONTH').toISOString().slice(0, 10)).toBe('2026-10-01');
    });

    it('defaults to 12 weeks / 6 months from today', () => {
      const weeks = buildGrid({ today: TODAY, size: 'WEEK' });
      expect(weeks.periods).toHaveLength(13); // the (partial) week of today + 12 more
      expect(weeks.periods[0]!.key).toBe('2026-10-05');
      const months = buildGrid({ today: TODAY, size: 'MONTH' });
      expect(months.periods.map((p) => p.key)).toEqual([
        '2026-10-01',
        '2026-11-01',
        '2026-12-01',
        '2027-01-01',
        '2027-02-01',
        '2027-03-01',
      ]);
      expect(months.periods.at(-1)!.end.toISOString().slice(0, 10)).toBe('2027-03-31');
    });

    it('reads a past from as today, honours to, and caps the number of periods', () => {
      const grid = buildGrid({ today: TODAY, from: d('2026-01-01'), to: d('2026-10-31'), size: 'WEEK' });
      expect(grid.periods[0]!.key).toBe('2026-10-05');
      expect(grid.periods.at(-1)!.key).toBe('2026-10-26');
      expect(buildGrid({ today: TODAY, to: d('2040-01-01'), size: 'WEEK' }).periods).toHaveLength(MAX_PERIODS);
    });
  });

  describe('bucketing', () => {
    const grid = buildGrid({ today: TODAY, size: 'WEEK' });

    it('lumps anything due before today into NOW, including earlier days of this week', () => {
      expect(bucketKeyFor(d('2026-08-01'), grid)).toBe('NOW');
      expect(bucketKeyFor(d('2026-10-06'), grid)).toBe('NOW'); // yesterday, same week
      expect(bucketKeyFor(d('2026-10-07'), grid)).toBe('2026-10-05'); // today
      expect(bucketKeyFor(d('2026-10-12'), grid)).toBe('2026-10-12');
    });

    it('puts items after the range in LATER and dateless ones in UNDATED', () => {
      expect(bucketKeyFor(d('2027-06-01'), grid)).toBe('LATER');
      expect(bucketKeyFor(null, grid)).toBe('UNDATED');
    });

    it('with a future from, NOW also holds what falls due before the range', () => {
      const later = buildGrid({ today: TODAY, from: d('2026-11-02'), size: 'WEEK' });
      expect(bucketKeyFor(d('2026-10-20'), later)).toBe('NOW');
      expect(bucketKeyFor(d('2026-11-03'), later)).toBe('2026-11-02');
    });
  });

  describe('dates and terms', () => {
    it('bills a stage on its planned date, or when marked ready if earlier, never in the past', () => {
      expect(expectedBillDate({ expectedDate: '2026-12-01', readyToBillAt: null, today: TODAY })).toEqual(d('2026-12-01'));
      expect(
        expectedBillDate({ expectedDate: '2026-12-01', readyToBillAt: new Date('2026-10-20T10:00:00Z'), today: TODAY }),
      ).toEqual(d('2026-10-20'));
      // Planned in the past (or marked ready earlier): an invoice is dated the day it is issued, so today.
      expect(expectedBillDate({ expectedDate: '2026-09-01', readyToBillAt: null, today: TODAY })).toEqual(d('2026-10-07'));
      expect(expectedBillDate({ expectedDate: null, readyToBillAt: d('2026-09-15'), today: TODAY })).toEqual(d('2026-10-07'));
    });

    it('leaves a stage with no date and no readiness undated', () => {
      expect(expectedBillDate({ expectedDate: null, readyToBillAt: null, today: TODAY })).toBeNull();
    });

    it('pays an order on delivery + supplier terms; either missing means undated', () => {
      expect(expectedCommitmentPayDate(d('2026-11-01'), 30)).toEqual(d('2026-12-01'));
      expect(expectedCommitmentPayDate(d('2026-11-01'), 0)).toEqual(d('2026-11-01'));
      expect(expectedCommitmentPayDate(null, 30)).toBeNull();
      expect(expectedCommitmentPayDate(d('2026-11-01'), null)).toBeNull();
    });
  });

  describe('buildForecast', () => {
    const grid = buildGrid({ today: TODAY, size: 'MONTH' });
    const item = (line: CashflowItem['line'], amount: number, date: string | null, currency = 'USD'): CashflowItem => ({
      line,
      currency,
      amount: new Decimal(amount),
      date: date ? d(date) : null,
    });

    const items = [
      item('fromInvoices', 1000, '2026-09-01'), // overdue → NOW
      item('fromInvoices', 500, '2026-10-20'),
      item('fromUnbilledStages', 2000, '2026-11-15'),
      item('fromUnbilledStages', 700, null),
      item('fromSupplierBills', 300, '2026-10-01'), // before today → NOW
      item('fromOpenCommitments', 400, '2026-11-30'),
      item('fromOpenCommitments', 900, '2028-01-01'), // after the range → LATER
      item('fromInvoices', 50, '2026-10-20', 'SOS'),
    ];
    const forecast = buildForecast(items, grid, true);

    it('keeps currencies apart, ordered by code', () => {
      expect(forecast.map((c) => c.currency)).toEqual(['SOS', 'USD']);
      expect(forecast[0]!.totals.inflows.total).toBe('50.00');
    });

    it('splits lines, nets and accumulates in bucket order', () => {
      const f = forecast[1]!;
      const by = (key: string) => f.buckets.find((b) => b.key === key)!;
      expect(f.buckets.map((b) => b.kind)).toEqual([
        'NOW',
        'PERIOD',
        'PERIOD',
        'PERIOD',
        'PERIOD',
        'PERIOD',
        'PERIOD',
        'LATER',
        'UNDATED',
      ]);
      expect(by('NOW')).toMatchObject({
        inflows: { fromInvoices: '1000.00', total: '1000.00' },
        outflows: { fromSupplierBills: '300.00', total: '300.00' },
        net: '700.00',
        cumulativeNet: '700.00',
        end: '2026-10-06',
      });
      expect(by('2026-10-01')).toMatchObject({ net: '500.00', cumulativeNet: '1200.00' });
      expect(by('2026-11-01')).toMatchObject({
        inflows: { fromUnbilledStages: '2000.00' },
        outflows: { fromOpenCommitments: '400.00' },
        net: '1600.00',
        cumulativeNet: '2800.00',
      });
      expect(by('LATER')).toMatchObject({ net: '-900.00', cumulativeNet: '1900.00', start: '2027-04-01' });
      expect(by('UNDATED')).toMatchObject({ inflows: { fromUnbilledStages: '700.00' }, cumulativeNet: null });
      expect(f.totals).toEqual({
        inflows: { fromInvoices: '1500.00', fromUnbilledStages: '2700.00', total: '4200.00' },
        outflows: { fromSupplierBills: '300.00', fromOpenCommitments: '1300.00', total: '1600.00' },
        net: '2600.00',
      });
      expect(f.counts).toEqual({ fromInvoices: 2, fromUnbilledStages: 2, fromSupplierBills: 1, fromOpenCommitments: 2 });
    });

    it('hides money but keeps counts when money is not visible', () => {
      const [hidden] = buildForecast([item('fromInvoices', 10, '2026-10-20')], grid, false);
      expect(hidden!.totals.net).toBeNull();
      expect(hidden!.buckets.every((b) => b.net === null && b.cumulativeNet === null)).toBe(true);
      expect(hidden!.counts.fromInvoices).toBe(1);
    });
  });
});
