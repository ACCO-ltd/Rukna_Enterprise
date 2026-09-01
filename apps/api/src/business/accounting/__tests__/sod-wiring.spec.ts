import { ForbiddenException } from '@nestjs/common';

import { ManualJournalService } from '../manual-journals/application/manual-journal.service.js';
import { SupplierBillService } from '../accounts-payable/application/supplier-bill.service.js';
import { SupplierPaymentService } from '../accounts-payable/application/supplier-payment.service.js';

/**
 * ADR-022 CONST-DOA-003 — proves each accounting/AP command hands the SoD service the right actors,
 * including the two that walk a link to find the prior party (bill → PO goods receivers, payment →
 * settled bills' approvers). The SoD brain is covered in segregation-of-duties.service.spec.
 */
const identity = (userId: string) =>
  ({ userId, activeOrganizationId: 'o1', roles: [], permissions: [] }) as never;

const denyingSod = () => ({
  assertAllowed: jest.fn().mockRejectedValue(new ForbiddenException('SoD')),
});

describe('Accounting SoD wiring (ADR-022)', () => {
  it('supplier payment: the vendor maintainer processing a payment is checked as PROCESS_SUPPLIER_PAYMENT', async () => {
    const sod = denyingSod();
    const prisma = {
      supplier: { findFirst: jest.fn().mockResolvedValue({ createdBy: 'alice' }) },
    };
    const svc = new SupplierPaymentService(
      { getClient: () => prisma } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      sod as never,
      {} as never,
    );

    await expect(
      svc.create(identity('alice'), {
        supplierId: 's1',
        bankAccountId: 'bank-1',
        paymentDate: '2026-09-01',
        currencyCode: 'USD',
        totalAmount: 100,
        paymentMethod: 'BANK_TRANSFER',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(sod.assertAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PROCESS_SUPPLIER_PAYMENT',
        actorUserId: 'alice',
        vendorMaintainerUserId: 'alice',
      }),
    );
  });

  it('manual journal: the preparer approving is checked as APPROVE_MANUAL_JOURNAL', async () => {
    const sod = denyingSod();
    const prisma = {
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue({ id: 'j1', status: 'SUBMITTED', createdBy: 'alice' }),
      },
    };
    const svc = new ManualJournalService(
      { getClient: () => prisma } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never, // commandGovernance — approve() does not consult the seam
      sod as never,
    );

    await expect(
      svc.approve(identity('alice'), { journalId: 'j1', approved: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(sod.assertAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPROVE_MANUAL_JOURNAL',
        actorUserId: 'alice',
        journalPreparerUserId: 'alice',
      }),
    );
  });

  it('manual journal: rejecting is not an approval and skips the SoD check', async () => {
    const sod = denyingSod();
    const prisma = {
      journalEntry: {
        findFirst: jest.fn().mockResolvedValue({ id: 'j1', status: 'SUBMITTED', createdBy: 'alice' }),
        update: jest.fn().mockResolvedValue({ id: 'j1', status: 'REJECTED' }),
      },
    };
    const svc = new ManualJournalService(
      { getClient: () => prisma } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never, // commandGovernance — approve() does not consult the seam
      sod as never,
    );

    await svc.approve(identity('alice'), { journalId: 'j1', approved: false, rejectionReason: 'bad' });
    expect(sod.assertAllowed).not.toHaveBeenCalled();
  });

  it('supplier bill: the goods receiver approving is checked as APPROVE_SUPPLIER_BILL', async () => {
    const sod = denyingSod();
    const prisma = {
      supplierBill: {
        findFirst: jest.fn().mockResolvedValue({ id: 'b1', documentStatus: 'SUBMITTED', purchaseOrderId: 'po1' }),
      },
      goodsReceiptNote: { findMany: jest.fn().mockResolvedValue([{ createdBy: 'alice' }]) },
    };
    const svc = new SupplierBillService(
      { getClient: () => prisma } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never, // billMatching
      {} as never,
      sod as never,
    );

    await expect(svc.approve(identity('alice'), 'b1')).rejects.toBeInstanceOf(ForbiddenException);

    expect(sod.assertAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPROVE_SUPPLIER_BILL',
        actorUserId: 'alice',
        goodsReceiverUserId: 'alice',
      }),
    );
  });

  it('supplier bill: a non-PO bill has no goods receipt, so goodsReceiverUserId is undefined', async () => {
    const sod = { assertAllowed: jest.fn() };
    const prisma = {
      supplierBill: {
        findFirst: jest.fn().mockResolvedValue({ id: 'b1', documentStatus: 'SUBMITTED', purchaseOrderId: null }),
      },
      goodsReceiptNote: { findMany: jest.fn() },
    };
    const repo = { approve: jest.fn().mockResolvedValue({ id: 'b1', documentStatus: 'APPROVED' }) };
    const svc = new SupplierBillService(
      { getClient: () => prisma } as never,
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never, // billMatching
      {} as never,
      sod as never,
    );

    await svc.approve(identity('alice'), 'b1');
    // No PO → the rule cannot apply, and we never query goods receipts.
    expect(prisma.goodsReceiptNote.findMany).not.toHaveBeenCalled();
    expect(sod.assertAllowed).not.toHaveBeenCalled();
    expect(repo.approve).toHaveBeenCalled();
  });

  it('supplier payment: approving a payment that settles a bill you approved is checked', async () => {
    const sod = denyingSod();
    const prisma = {
      supplierPaymentAllocation: {
        findMany: jest.fn().mockResolvedValue([{ bill: { approvedBy: 'alice' } }]),
      },
    };
    const paymentRepo = {
      findById: jest.fn().mockResolvedValue({ id: 'p1', documentStatus: 'DRAFT' }),
    };
    const svc = new SupplierPaymentService(
      { getClient: () => prisma } as never,
      paymentRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      sod as never,
      {} as never,
    );

    await expect(svc.approve(identity('alice'), 'p1')).rejects.toBeInstanceOf(ForbiddenException);

    expect(sod.assertAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPROVE_OR_RELEASE_SUPPLIER_PAYMENT',
        actorUserId: 'alice',
        supplierBillApproverUserId: 'alice',
      }),
    );
  });
});
