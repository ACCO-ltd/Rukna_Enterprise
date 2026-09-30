import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { SupplierBillService } from './supplier-bill.service.js';

/**
 * ADR-037 amendment (2026-09-27): a submitted supplier bill can be returned for correction
 * (back to DRAFT, with a reason) or rejected (final, with a reason); a draft can be edited.
 */

const identity = { userId: 'u-approver', activeOrganizationId: 'o1', roles: [], permissions: [] } as never;

const DTO = {
  supplierId: 's1',
  supplierInvoiceNumber: 'BCC/INV/5531',
  billDate: '2026-09-14',
  dueDate: '2026-10-14',
  currencyCode: 'USD',
  lines: [{ description: 'Office rent', netAmount: 5060, vatAmount: 0, expenseProfileCode: 'OFFICE_EXPENSE' }],
};

function build(
  bill: { id: string; documentStatus: string; createdBy?: string } | null,
  duplicate: unknown = null,
  approvalState: 'PENDING' | 'APPROVED' | null = null,
) {
  const supplierBill = {
    // requireStatus: the bill is found only in the status it asks for.
    findFirst: jest.fn().mockImplementation(({ where }: { where: { documentStatus: string } }) =>
      Promise.resolve(bill && bill.documentStatus === where.documentStatus ? bill : null),
    ),
    update: jest.fn().mockImplementation(({ data }: { data: object }) => Promise.resolve({ ...bill, ...data })),
  };
  const supplierBillMatch = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
  const supplierBillLine = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
  const prisma = {
    supplierBill,
    supplierBillMatch,
    supplierBillLine,
    journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
    postingProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn().mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma)),
  };
  const repo = {
    findBySupplierInvoiceNumber: jest.fn().mockResolvedValue(duplicate),
    findById: jest.fn().mockResolvedValue({ ...bill, postedJournalEntryId: null, reversalJournalEntryId: null }),
  };
  const governance = {
    openApprovalState: jest.fn().mockResolvedValue(approvalState),
    voidUnconsumedApproval: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new SupplierBillService(
    { getClient: () => prisma } as never,
    repo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    governance as never,
    {} as never,
  );
  return { svc, prisma, repo, governance };
}

describe('SupplierBillService — return for correction', () => {
  it('sends a submitted bill back to DRAFT with the reason, and discards its stale match', async () => {
    const { svc, prisma } = build({ id: 'b1', documentStatus: 'SUBMITTED' });
    await svc.returnForCorrection(identity, 'b1', '  Amount is $5,060, not $5,660.  ');
    expect(prisma.supplierBillMatch.deleteMany).toHaveBeenCalledWith({ where: { supplierBillId: 'b1' } });
    expect(prisma.supplierBill.update).toHaveBeenCalledWith({
      where: { id: 'b1', documentStatus: 'SUBMITTED' },
      data: expect.objectContaining({
        documentStatus: 'DRAFT',
        matchStatus: 'NOT_RUN',
        returnedBy: 'u-approver',
        returnReason: 'Amount is $5,060, not $5,660.',
      }),
    });
  });

  it('lets the person who entered the bill return it — correcting their own bill is harmless', async () => {
    const { svc, prisma } = build({ id: 'b1', documentStatus: 'SUBMITTED', createdBy: 'u-approver' });
    await svc.returnForCorrection(identity, 'b1', 'I typed the wrong amount.');
    expect(prisma.supplierBill.update).toHaveBeenCalled();
  });

  it('requires a reason', async () => {
    const { svc, prisma } = build({ id: 'b1', documentStatus: 'SUBMITTED' });
    await expect(svc.returnForCorrection(identity, 'b1', '   ')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.supplierBill.update).not.toHaveBeenCalled();
  });

  it('only returns a submitted bill', async () => {
    const { svc } = build({ id: 'b1', documentStatus: 'APPROVED' });
    await expect(svc.returnForCorrection(identity, 'b1', 'Wrong amount')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SupplierBillService — reject', () => {
  it('rejects a submitted bill for good, with the reason', async () => {
    const { svc, prisma } = build({ id: 'b1', documentStatus: 'SUBMITTED' });
    await svc.reject(identity, 'b1', 'Duplicate of BILL-2026-0041.');
    expect(prisma.supplierBill.update).toHaveBeenCalledWith({
      where: { id: 'b1', documentStatus: 'SUBMITTED' },
      data: expect.objectContaining({
        documentStatus: 'REJECTED',
        rejectedBy: 'u-approver',
        rejectionReason: 'Duplicate of BILL-2026-0041.',
      }),
    });
  });

  it('refuses the person who entered the bill — someone else must reject it', async () => {
    const { svc, prisma } = build({ id: 'b1', documentStatus: 'SUBMITTED', createdBy: 'u-approver' });
    await expect(svc.reject(identity, 'b1', 'Duplicate invoice.')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.supplierBill.update).not.toHaveBeenCalled();
  });

  it('requires a reason and a submitted bill', async () => {
    const { svc } = build({ id: 'b1', documentStatus: 'SUBMITTED' });
    await expect(svc.reject(identity, 'b1', '')).rejects.toBeInstanceOf(BadRequestException);
    const draft = build({ id: 'b2', documentStatus: 'DRAFT' });
    await expect(draft.svc.reject(identity, 'b2', 'No')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SupplierBillService — edit a draft', () => {
  it('replaces the lines, recomputes totals server-side and resets the match', async () => {
    const { svc, prisma, repo } = build({ id: 'b1', documentStatus: 'DRAFT' });
    await svc.update(identity, 'b1', DTO);
    // The bill being edited never collides with its own number.
    expect(repo.findBySupplierInvoiceNumber).toHaveBeenCalledWith(prisma, 'o1', 's1', 'BCC/INV/5531', 'b1');
    expect(prisma.supplierBillLine.deleteMany).toHaveBeenCalledWith({ where: { supplierBillId: 'b1' } });
    const { data } = prisma.supplierBill.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(String(data.totalAmount)).toBe('5060');
    expect(data.matchStatus).toBe('NOT_RUN');
    expect(data.supplierInvoiceNumberNorm).toBe('BCCINV5531');
  });

  it('refuses a number another live bill holds', async () => {
    const { svc } = build({ id: 'b1', documentStatus: 'DRAFT' }, { id: 'b9', billNumber: 'BILL-2026-0040' });
    await expect(svc.update(identity, 'b1', DTO)).rejects.toBeInstanceOf(ConflictException);
  });

  it('never edits a bill past DRAFT', async () => {
    const { svc } = build({ id: 'b1', documentStatus: 'SUBMITTED' });
    await expect(svc.update(identity, 'b1', DTO)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SupplierBillService — review fixes (PR #221)', () => {
  it('refuses to edit a draft while its approval is pending — approvers must see what they approve', async () => {
    const { svc, prisma } = build({ id: 'b1', documentStatus: 'DRAFT' }, null, 'PENDING');
    await expect(svc.update(identity, 'b1', DTO)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.supplierBill.update).not.toHaveBeenCalled();
  });

  it('voids a granted-but-unused approval when the draft is edited, so resubmitting re-approves', async () => {
    const { svc, governance } = build({ id: 'b1', documentStatus: 'DRAFT' }, null, 'APPROVED');
    await svc.update(identity, 'b1', DTO);
    expect(governance.voidUnconsumedApproval).toHaveBeenCalledWith('SUPPLIER_BILL', 'b1');
  });

  it('guards every transition on the status it expects, and turns a lost race into a 409', async () => {
    const { svc, prisma } = build({ id: 'b1', documentStatus: 'SUBMITTED' });
    await svc.reject(identity, 'b1', 'Duplicate invoice.');
    expect(prisma.supplierBill.update.mock.calls[0]![0].where).toEqual({ id: 'b1', documentStatus: 'SUBMITTED' });

    const { Prisma } = await import('@prisma/client');
    prisma.supplierBill.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Record to update not found.', { code: 'P2025', clientVersion: 'test' }),
    );
    await expect(svc.reject(identity, 'b1', 'Duplicate invoice.')).rejects.toBeInstanceOf(ConflictException);
  });
});
