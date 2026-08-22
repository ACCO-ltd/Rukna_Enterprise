import { PaymentReceiptArRepository } from './payment-receipt-ar.repository.js';

describe('PaymentReceiptArRepository.findAllocationsByReceipt (ACC-SET-001)', () => {
  it('returns every allocation on the receipt — including REVERSED — newest first', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { clientReceiptAllocation: { findMany } };
    const repo = new PaymentReceiptArRepository();

    await repo.findAllocationsByReceipt(prisma as never, 'receipt-1');

    const arg = findMany.mock.calls[0]![0];
    // No postingStatus filter — a REVERSED allocation must still surface (audit trail).
    expect(arg.where).toEqual({ paymentReceiptId: 'receipt-1' });
    expect(arg.where.postingStatus).toBeUndefined();
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
  });
});
