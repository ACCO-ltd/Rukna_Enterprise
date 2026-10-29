import { Decimal } from '@prisma/client/runtime/library';

/**
 * ADR-046 §5 — what one IPC invoice bills.
 *
 * IPA and IPC quantities are cumulative to date (ADR-005 CONST-IPC-015), so a certificate's gross
 * and deductions are figures *to date*. An invoice bills the period: the certificate's to-date
 * figures minus what earlier IPC invoices on the same contract already billed. Billing the whole
 * certificate re-billed every earlier one.
 *
 * Pure: the caller loads the certificate and the earlier invoices; nothing here reads a database.
 */

/** Gross, retention, advance recovery and other deductions, all as amounts to date or billed. */
export interface IpcAmounts {
  gross: Decimal;
  retention: Decimal;
  advanceRecovery: Decimal;
  other: Decimal;
}

/** One earlier IPC invoice on the contract (draft or posted, not cancelled, not reversed). */
export interface EarlierIpcInvoice {
  /** Null on IPC invoices raised before ADR-046 §5: they billed `subtotal` gross, nothing netted. */
  certifiedGrossAmount: Decimal | null;
  subtotal: Decimal;
  retentionAmount: Decimal;
  advanceRecoveryAmount: Decimal;
  otherDeductionsAmount: Decimal;
  /** Net amounts of posted credit notes against this invoice — they reduce what was billed. */
  creditedNet: Decimal;
}

export interface IpcInvoicePeriod extends IpcAmounts {
  /** Revenue and tax base: gross − other deductions. */
  revenue: Decimal;
}

export class IpcInvoicePeriodError extends Error {
  constructor(
    message: string,
    readonly code: 'IPC_PERIOD_NEGATIVE' | 'IPC_NOTHING_TO_BILL',
  ) {
    super(message);
    this.name = 'IpcInvoicePeriodError';
  }
}

const ZERO = new Decimal(0);

/** Sum of what earlier IPC invoices billed, component by component. */
export function billedToDate(invoices: readonly EarlierIpcInvoice[]): IpcAmounts {
  return invoices.reduce<IpcAmounts>(
    (acc, inv) => ({
      // A legacy invoice billed its subtotal as gross; a credit note takes revenue back.
      gross: acc.gross
        .plus(inv.certifiedGrossAmount ?? inv.subtotal)
        .minus(inv.creditedNet),
      retention: acc.retention.plus(inv.retentionAmount),
      advanceRecovery: acc.advanceRecovery.plus(inv.advanceRecoveryAmount),
      other: acc.other.plus(inv.otherDeductionsAmount),
    }),
    { gross: ZERO, retention: ZERO, advanceRecovery: ZERO, other: ZERO },
  );
}

/**
 * The period to invoice: certificate to date − billed to date.
 *
 * Throws when a component would go negative (the certificate is below what was already billed —
 * a downward revision, a dropped line, or an earlier invoice raised on the cumulative figure) or
 * when there is no revenue left to bill. Either way finance corrects the earlier invoices with a
 * credit note; the message carries the figures.
 */
export function ipcInvoicePeriod(certificate: IpcAmounts, billed: IpcAmounts): IpcInvoicePeriod {
  const period: IpcAmounts = {
    gross: certificate.gross.minus(billed.gross),
    retention: certificate.retention.minus(billed.retention),
    advanceRecovery: certificate.advanceRecovery.minus(billed.advanceRecovery),
    other: certificate.other.minus(billed.other),
  };

  for (const [name, amount] of Object.entries(period) as [keyof IpcAmounts, Decimal][]) {
    if (amount.isNegative()) {
      throw new IpcInvoicePeriodError(
        `This certificate's ${label(name)} to date (${certificate[name].toFixed(2)}) is below what ` +
          `earlier invoices on the contract already billed (${billed[name].toFixed(2)}). ` +
          `Correct the earlier invoices with a credit note before invoicing this certificate.`,
        'IPC_PERIOD_NEGATIVE',
      );
    }
  }

  const revenue = period.gross.minus(period.other);
  // `.gt(0)`, not `isPositive()`: Decimal.js counts zero as positive.
  if (!revenue.gt(0)) {
    throw new IpcInvoicePeriodError(
      `Nothing new to bill: this certificate's gross to date (${certificate.gross.toFixed(2)}) ` +
        `is already covered by earlier invoices on the contract (${billed.gross.toFixed(2)}).`,
      'IPC_NOTHING_TO_BILL',
    );
  }

  return { ...period, revenue };
}

function label(name: keyof IpcAmounts): string {
  switch (name) {
    case 'gross':
      return 'gross certified';
    case 'retention':
      return 'retention';
    case 'advanceRecovery':
      return 'advance recovery';
    case 'other':
      return 'other deductions';
  }
}
