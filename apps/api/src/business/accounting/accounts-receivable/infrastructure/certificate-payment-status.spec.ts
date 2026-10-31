import { PaymentReceiptArRepository } from './payment-receipt-ar.repository.js';

/**
 * ADR-024 ACC-SET-001 (D2) — IPC payment status is measured against the ClientInvoice
 * total, never the netCertified. Worked example:
 *   certified 100,000 less 5,000 retention = invoice 95,000; received 95,000 → PAID, outstanding 0.
 * (Moved from the retired finance module in BE-2.)
 */

interface MockShape {
  cert?: { items: { certifiedAmount: string }[]; deductions: { amount: string }[] } | null;
  invoice?: { id: string; totalAmount: string } | null;
  received?: string | null;
}

function mockPrisma(shape: MockShape) {
  return {
    interimPaymentCertificate: {
      findUnique: jest.fn().mockResolvedValue(
        shape.cert === undefined ? { items: [], deductions: [] } : shape.cert,
      ),
    },
    clientInvoice: {
      findFirst: jest.fn().mockResolvedValue(shape.invoice ?? null),
    },
    clientReceiptAllocation: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { allocatedAmount: shape.received ?? null } }),
    },
  } as never;
}

const repo = new PaymentReceiptArRepository();
const CERTIFIED = { items: [{ certifiedAmount: '100000' }], deductions: [] };

describe('getCertificatePaymentSummary (ADR-024 ACC-SET-001)', () => {
  it('UNINVOICED when the IPC has no live invoice', async () => {
    const result = await repo.getCertificatePaymentSummary(
      mockPrisma({ cert: CERTIFIED, invoice: null }),
      'ipc-1',
    );
    expect(result).toMatchObject({
      status: 'UNINVOICED',
      netCertified: '100000.00',
      invoiceTotal: null,
      outstanding: null,
      totalReceived: '0.00',
      paidPercent: '0',
    });
  });

  it('PAID against the invoice total (worked example)', async () => {
    const result = await repo.getCertificatePaymentSummary(
      mockPrisma({
        cert: CERTIFIED,
        invoice: { id: 'inv-1', totalAmount: '95000' },
        received: '95000',
      }),
      'ipc-1',
    );
    expect(result).toMatchObject({
      status: 'PAID',
      netCertified: '100000.00',
      invoiceTotal: '95000.00',
      totalReceived: '95000.00',
      outstanding: '0.00',
      paidPercent: '100.0',
    });
  });

  it('PARTIALLY_PAID reports outstanding against the invoice total', async () => {
    const result = await repo.getCertificatePaymentSummary(
      mockPrisma({
        cert: CERTIFIED,
        invoice: { id: 'inv-1', totalAmount: '95000' },
        received: '50000',
      }),
      'ipc-1',
    );
    expect(result).toMatchObject({
      status: 'PARTIALLY_PAID',
      totalReceived: '50000.00',
      outstanding: '45000.00',
    });
  });

  it('UNPAID when invoiced but nothing received', async () => {
    const result = await repo.getCertificatePaymentSummary(
      mockPrisma({
        cert: CERTIFIED,
        invoice: { id: 'inv-1', totalAmount: '95000' },
        received: null,
      }),
      'ipc-1',
    );
    expect(result).toMatchObject({
      status: 'UNPAID',
      totalReceived: '0.00',
      outstanding: '95000.00',
    });
  });
});
