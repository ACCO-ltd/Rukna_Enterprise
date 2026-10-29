import { Decimal } from '@prisma/client/runtime/library';

import {
  billedToDate,
  ipcInvoicePeriod,
  IpcInvoicePeriodError,
  type EarlierIpcInvoice,
  type IpcAmounts,
} from './ipc-invoice-period.policy.js';

const d = (v: string | number) => new Decimal(v);
const amounts = (gross: number, retention = 0, advanceRecovery = 0, other = 0): IpcAmounts => ({
  gross: d(gross),
  retention: d(retention),
  advanceRecovery: d(advanceRecovery),
  other: d(other),
});
const earlier = (over: Partial<EarlierIpcInvoice>): EarlierIpcInvoice => ({
  certifiedGrossAmount: null,
  subtotal: d(0),
  retentionAmount: d(0),
  advanceRecoveryAmount: d(0),
  otherDeductionsAmount: d(0),
  creditedNet: d(0),
  ...over,
});
const fixed = (p: IpcAmounts & { revenue: Decimal }) => ({
  gross: p.gross.toFixed(2),
  retention: p.retention.toFixed(2),
  advanceRecovery: p.advanceRecovery.toFixed(2),
  other: p.other.toFixed(2),
  revenue: p.revenue.toFixed(2),
});

describe('ipcInvoicePeriod (ADR-046 §5)', () => {
  it('bills the whole certificate when nothing was billed before', () => {
    const period = ipcInvoicePeriod(amounts(100_000, 5_000, 10_000), billedToDate([]));

    expect(fixed(period)).toEqual({
      gross: '100000.00', retention: '5000.00', advanceRecovery: '10000.00', other: '0.00', revenue: '100000.00',
    });
  });

  it('bills only the period on the second certificate (the owner example)', () => {
    // IPC #1 billed 100,000 gross, 5,000 retention. IPC #2 is 250,000 gross, 12,500 retention to date.
    const billed = billedToDate([
      earlier({ certifiedGrossAmount: d(100_000), subtotal: d(100_000), retentionAmount: d(5_000) }),
    ]);
    const period = ipcInvoicePeriod(amounts(250_000, 12_500), billed);

    expect(fixed(period)).toEqual({
      gross: '150000.00', retention: '7500.00', advanceRecovery: '0.00', other: '0.00', revenue: '150000.00',
    });
    // Amount due before tax = 150,000 − 7,500 = 142,500.
    expect(period.revenue.minus(period.retention).toFixed(2)).toBe('142500.00');
  });

  it('treats a legacy invoice as gross = subtotal with nothing netted', () => {
    const billed = billedToDate([earlier({ certifiedGrossAmount: null, subtotal: d(80_000) })]);

    expect(ipcInvoicePeriod(amounts(120_000, 6_000), billed).gross.toFixed(2)).toBe('40000.00');
    // The legacy invoice withheld no retention, so the whole retention to date catches up now.
    expect(ipcInvoicePeriod(amounts(120_000, 6_000), billed).retention.toFixed(2)).toBe('6000.00');
  });

  it('subtracts posted credit notes from what was billed', () => {
    const billed = billedToDate([
      earlier({ certifiedGrossAmount: d(100_000), subtotal: d(100_000), creditedNet: d(20_000) }),
    ]);

    expect(ipcInvoicePeriod(amounts(130_000), billed).gross.toFixed(2)).toBe('50000.00');
  });

  it('nets other deductions out of revenue', () => {
    const period = ipcInvoicePeriod(amounts(50_000, 0, 0, 2_000), billedToDate([]));

    expect(period.revenue.toFixed(2)).toBe('48000.00');
  });

  it('refuses when the certificate is below what was already billed', () => {
    // A legacy invoice billed the cumulative 250,000; the next certificate is 300,000 to date but its
    // retention (15,000) is fine — the gross is what went wrong on a re-billed cumulative invoice.
    const billed = billedToDate([earlier({ subtotal: d(100_000) }), earlier({ subtotal: d(250_000) })]);

    expect(() => ipcInvoicePeriod(amounts(300_000), billed)).toThrow(IpcInvoicePeriodError);
    try {
      ipcInvoicePeriod(amounts(300_000), billed);
    } catch (err) {
      expect((err as IpcInvoicePeriodError).code).toBe('IPC_PERIOD_NEGATIVE');
      expect((err as Error).message).toContain('350000.00');
    }
  });

  it('refuses when there is nothing new to bill', () => {
    const billed = billedToDate([earlier({ certifiedGrossAmount: d(100_000), subtotal: d(100_000) })]);

    expect(() => ipcInvoicePeriod(amounts(100_000), billed)).toThrow(
      expect.objectContaining({ code: 'IPC_NOTHING_TO_BILL' }),
    );
  });
});
