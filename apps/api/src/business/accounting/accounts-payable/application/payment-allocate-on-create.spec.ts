import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { SupplierPaymentService } from './supplier-payment.service.js';

/**
 * A16 (D9) — supplier-payment allocate-on-create. The common path is: create a payment AND select
 * bills + allocate amounts in one flow, supporting full settlement, partial payment, one payment
 * across multiple bills, and an unapplied balance (payment > Σ allocations → supplier advance).
 *
 * These are pure unit tests: repositories and the tenant Prisma client are mocked, and `$transaction`
 * runs the callback synchronously against the same mock so the create body executes end-to-end. We
 * assert the side effects the doctrine requires: each allocation reduces the target bill's outstanding
 * atomically; validations reject bad allocations; and posting splits Dr AP / Dr Advance / Cr Bank on
 * the payment's accountingDate.
 */

const identity = { userId: 'u1', activeOrganizationId: 'o1', roles: [], permissions: [] } as never;

interface BillSeed {
  id: string;
  supplierId: string;
  currencyCode: string;
  outstandingAmount: number;
  postingStatus?: string;
  organizationId?: string;
}

/**
 * Build the service with a fake bill store. billRepo.findById resolves the current bill state (so a
 * second allocation to the same bill in one create sees the reduced outstanding), and
 * updateOutstandingAmount mutates that store — exactly what the real transaction does.
 */
function build(bills: BillSeed[]) {
  const store = new Map(
    bills.map((b) => [
      b.id,
      {
        ...b,
        postingStatus: b.postingStatus ?? 'POSTED',
        organizationId: b.organizationId ?? 'o1',
        outstandingAmount: new Decimal(b.outstandingAmount),
      },
    ]),
  );

  const createdPayment: Record<string, unknown> = {};
  const paymentRepo = {
    create: jest.fn().mockImplementation((_tx: unknown, data: Record<string, unknown>) => {
      Object.assign(createdPayment, { id: 'pay-1', ...data });
      return Promise.resolve(createdPayment);
    }),
    createAllocation: jest.fn().mockResolvedValue({ id: 'alloc-x' }),
  };
  const billRepo = {
    // Mirror the real repo: filters by org, so a cross-org bill resolves to null.
    findById: jest.fn().mockImplementation((_tx: unknown, orgId: string, id: string) => {
      const b = store.get(id);
      if (!b || b.organizationId !== orgId) return Promise.resolve(null);
      return Promise.resolve(b);
    }),
    updateOutstandingAmount: jest
      .fn()
      .mockImplementation((_tx: unknown, id: string, amount: Decimal) => {
        const b = store.get(id);
        if (b) b.outstandingAmount = amount;
        return Promise.resolve(b);
      }),
  };
  const prisma = {
    supplier: { findFirst: jest.fn().mockResolvedValue({ createdBy: 'vendor-maintainer' }) },
    $transaction: async (cb: (tx: unknown) => unknown) => cb(prisma),
  };
  const sod = { assertAllowed: jest.fn().mockResolvedValue(undefined) };

  const svc = new SupplierPaymentService(
    { getClient: () => prisma } as never,
    paymentRepo as never,
    billRepo as never,
    {} as never, // accountRepo
    {} as never, // sequenceRepo
    {} as never, // postingPort
    {} as never, // commandGovernance
    sod as never,
    {} as never, // signatoryService
  );
  return { svc, paymentRepo, billRepo, store, createdPayment };
}

const baseDto = {
  supplierId: 's1',
  bankAccountId: 'bank-1',
  paymentDate: '2026-02-01',
  currencyCode: 'USD',
  paymentMethod: 'BANK_TRANSFER',
};

describe('SupplierPaymentService.create — allocate-on-create (A16 / D9)', () => {
  it('full settlement: allocation == outstanding → bill outstanding becomes 0', async () => {
    const { svc, billRepo, store, createdPayment } = build([
      { id: 'b1', supplierId: 's1', currencyCode: 'USD', outstandingAmount: 1000 },
    ]);

    await svc.create(identity, {
      ...baseDto,
      totalAmount: 1000,
      allocations: [{ supplierBillId: 'b1', amount: 1000 }],
    });

    expect(store.get('b1')!.outstandingAmount.toFixed(2)).toBe('0.00');
    expect(billRepo.updateOutstandingAmount).toHaveBeenCalledTimes(1);
    // Fully applied → no unapplied advance.
    expect((createdPayment.allocatedAmount as Decimal).toFixed(2)).toBe('1000.00');
    expect((createdPayment.unallocatedAmount as Decimal).toFixed(2)).toBe('0.00');
  });

  it('partial payment: allocation < outstanding leaves the correct residual outstanding', async () => {
    const { svc, store } = build([
      { id: 'b1', supplierId: 's1', currencyCode: 'USD', outstandingAmount: 1000 },
    ]);

    await svc.create(identity, {
      ...baseDto,
      totalAmount: 400,
      allocations: [{ supplierBillId: 'b1', amount: 400 }],
    });

    expect(store.get('b1')!.outstandingAmount.toFixed(2)).toBe('600.00');
  });

  it('one payment across multiple bills allocates to each correctly', async () => {
    const { svc, billRepo, store, createdPayment } = build([
      { id: 'b1', supplierId: 's1', currencyCode: 'USD', outstandingAmount: 1000 },
      { id: 'b2', supplierId: 's1', currencyCode: 'USD', outstandingAmount: 500 },
    ]);

    await svc.create(identity, {
      ...baseDto,
      totalAmount: 1500,
      allocations: [
        { supplierBillId: 'b1', amount: 1000 },
        { supplierBillId: 'b2', amount: 300 },
      ],
    });

    expect(store.get('b1')!.outstandingAmount.toFixed(2)).toBe('0.00');
    expect(store.get('b2')!.outstandingAmount.toFixed(2)).toBe('200.00');
    expect(billRepo.updateOutstandingAmount).toHaveBeenCalledTimes(2);
    expect((createdPayment.allocatedAmount as Decimal).toFixed(2)).toBe('1300.00');
    expect((createdPayment.unallocatedAmount as Decimal).toFixed(2)).toBe('200.00');
  });

  it('unapplied balance: payment > Σ allocations → remainder tracked as supplier advance', async () => {
    const { svc, store, createdPayment } = build([
      { id: 'b1', supplierId: 's1', currencyCode: 'USD', outstandingAmount: 1000 },
    ]);

    await svc.create(identity, {
      ...baseDto,
      totalAmount: 1200,
      allocations: [{ supplierBillId: 'b1', amount: 1000 }],
    });

    expect(store.get('b1')!.outstandingAmount.toFixed(2)).toBe('0.00');
    expect((createdPayment.totalAmount as Decimal).toFixed(2)).toBe('1200.00');
    expect((createdPayment.allocatedAmount as Decimal).toFixed(2)).toBe('1000.00');
    // The 200 remainder is the supplier advance carried on the payment.
    expect((createdPayment.unallocatedAmount as Decimal).toFixed(2)).toBe('200.00');
  });

  it('pure advance: no allocations → whole amount is the unallocated advance', async () => {
    const { svc, billRepo, createdPayment } = build([]);

    await svc.create(identity, { ...baseDto, totalAmount: 750 });

    expect(billRepo.updateOutstandingAmount).not.toHaveBeenCalled();
    expect((createdPayment.allocatedAmount as Decimal).toFixed(2)).toBe('0.00');
    expect((createdPayment.unallocatedAmount as Decimal).toFixed(2)).toBe('750.00');
  });

  it('records the payment accountingDate (defaults to paymentDate) — accounting-date rule', async () => {
    const { svc, createdPayment } = build([
      { id: 'b1', supplierId: 's1', currencyCode: 'USD', outstandingAmount: 1000 },
    ]);

    await svc.create(identity, {
      ...baseDto,
      paymentDate: '2026-02-01',
      accountingDate: '2026-01-31',
      totalAmount: 500,
      allocations: [{ supplierBillId: 'b1', amount: 500 }],
    });

    expect((createdPayment.accountingDate as Date).toISOString().slice(0, 10)).toBe('2026-01-31');
  });

  it('creates one NOT_POSTED allocation row per bill (stamped POSTED only at payment post)', async () => {
    const { svc, paymentRepo } = build([
      { id: 'b1', supplierId: 's1', currencyCode: 'USD', outstandingAmount: 1000 },
      { id: 'b2', supplierId: 's1', currencyCode: 'USD', outstandingAmount: 1000 },
    ]);

    await svc.create(identity, {
      ...baseDto,
      totalAmount: 1500,
      allocations: [
        { supplierBillId: 'b1', amount: 1000 },
        { supplierBillId: 'b2', amount: 500 },
      ],
    });

    expect(paymentRepo.createAllocation).toHaveBeenCalledTimes(2);
    expect(paymentRepo.createAllocation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ supplierBillId: 'b1', postingStatus: 'NOT_POSTED' }),
    );
  });
});

describe('SupplierPaymentService.create — allocation validation (A16 / D9)', () => {
  it('rejects over-allocation: Σ allocations > payment amount', async () => {
    const { svc, billRepo } = build([
      { id: 'b1', supplierId: 's1', currencyCode: 'USD', outstandingAmount: 5000 },
    ]);

    await expect(
      svc.create(identity, {
        ...baseDto,
        totalAmount: 1000,
        allocations: [{ supplierBillId: 'b1', amount: 1500 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Rejected before any bill mutation.
    expect(billRepo.updateOutstandingAmount).not.toHaveBeenCalled();
  });

  it('rejects an allocation larger than that bill outstanding', async () => {
    const { svc, store } = build([
      { id: 'b1', supplierId: 's1', currencyCode: 'USD', outstandingAmount: 300 },
    ]);

    await expect(
      svc.create(identity, {
        ...baseDto,
        totalAmount: 1000,
        allocations: [{ supplierBillId: 'b1', amount: 500 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Bill untouched.
    expect(store.get('b1')!.outstandingAmount.toFixed(2)).toBe('300.00');
  });

  it('rejects a bill belonging to a different supplier', async () => {
    const { svc } = build([
      { id: 'b1', supplierId: 'OTHER-SUPPLIER', currencyCode: 'USD', outstandingAmount: 1000 },
    ]);

    await expect(
      svc.create(identity, {
        ...baseDto,
        totalAmount: 1000,
        allocations: [{ supplierBillId: 'b1', amount: 500 }],
      }),
    ).rejects.toThrow(/supplier does not match/i);
  });

  it('rejects a bill from a different organization (cross-org → not found)', async () => {
    const { svc } = build([
      {
        id: 'b1',
        supplierId: 's1',
        currencyCode: 'USD',
        outstandingAmount: 1000,
        organizationId: 'OTHER-ORG',
      },
    ]);

    await expect(
      svc.create(identity, {
        ...baseDto,
        totalAmount: 1000,
        allocations: [{ supplierBillId: 'b1', amount: 500 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a currency mismatch between bill and payment', async () => {
    const { svc } = build([
      { id: 'b1', supplierId: 's1', currencyCode: 'EUR', outstandingAmount: 1000 },
    ]);

    await expect(
      svc.create(identity, {
        ...baseDto,
        currencyCode: 'USD',
        totalAmount: 1000,
        allocations: [{ supplierBillId: 'b1', amount: 500 }],
      }),
    ).rejects.toThrow(/currency does not match/i);
  });

  it('rejects allocating to a non-POSTED (e.g. CANCELLED/DRAFT) bill', async () => {
    const { svc } = build([
      {
        id: 'b1',
        supplierId: 's1',
        currencyCode: 'USD',
        outstandingAmount: 1000,
        postingStatus: 'NOT_POSTED',
      },
    ]);

    await expect(
      svc.create(identity, {
        ...baseDto,
        totalAmount: 1000,
        allocations: [{ supplierBillId: 'b1', amount: 500 }],
      }),
    ).rejects.toThrow(/not POSTED/i);
  });

  it('rejects allocating to an already-settled bill (outstanding 0)', async () => {
    const { svc } = build([
      { id: 'b1', supplierId: 's1', currencyCode: 'USD', outstandingAmount: 0 },
    ]);

    await expect(
      svc.create(identity, {
        ...baseDto,
        totalAmount: 1000,
        allocations: [{ supplierBillId: 'b1', amount: 100 }],
      }),
    ).rejects.toThrow(/exceeds bill outstanding/i);
  });

  it('rejects a missing bill', async () => {
    const { svc } = build([]);

    await expect(
      svc.create(identity, {
        ...baseDto,
        totalAmount: 1000,
        allocations: [{ supplierBillId: 'ghost', amount: 100 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * Post-time journal split (EVT-AP-003). A payment created with a partial allocation (allocated < total)
 * must post Dr AP (allocated) / Dr Supplier Advance (unallocated) / Cr Bank (total), on the payment's
 * accountingDate. A fully-allocated payment omits the advance leg; a pure advance omits the AP leg.
 */
function buildPost(payment: Record<string, unknown>) {
  const captured: { post?: Record<string, unknown> } = {};
  const postingPort = {
    post: jest.fn().mockImplementation((cmd: Record<string, unknown>) => {
      captured.post = cmd;
      return Promise.resolve({ journalEntryId: 'je-1' });
    }),
  };
  const accountRepo = {
    findByCode: jest.fn().mockImplementation((_p: unknown, _o: string, code: string) =>
      Promise.resolve({ id: `acct-${code}` }),
    ),
  };
  const sequenceRepo = {
    ensureSequence: jest.fn().mockResolvedValue(undefined),
    claimNext: jest.fn().mockResolvedValue({ formattedNumber: 'PMT-0001' }),
  };
  const paymentRepo = {
    findById: jest.fn().mockResolvedValue(payment),
    markPosted: jest.fn().mockResolvedValue(payment),
    markPostingFailed: jest.fn().mockResolvedValue(payment),
  };
  const prisma = {
    supplierPaymentAllocation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: async (cb: (tx: unknown) => unknown) => cb(prisma),
  };
  const signatoryService = {
    requiresDualControl: jest.fn().mockResolvedValue(false),
  };
  const svc = new SupplierPaymentService(
    { getClient: () => prisma } as never,
    paymentRepo as never,
    {} as never,
    accountRepo as never,
    sequenceRepo as never,
    postingPort as never,
    {} as never,
    { assertAllowed: jest.fn() } as never,
    signatoryService as never,
  );
  return { svc, captured, postingPort };
}

const postDto = { apAccountCode: '21000', bankGlCode: '10200', supplierAdvanceCode: '13000' };

function lineFor(cmd: Record<string, unknown>, accountId: string) {
  const lines = cmd.lines as { accountId: string; debitAmount: Decimal; creditAmount: Decimal }[];
  return lines.find((l) => l.accountId === accountId);
}

describe('SupplierPaymentService.post — journal split for allocate-on-create (A16 / D9)', () => {
  const postedPayment = (over: Record<string, unknown>) => ({
    id: 'pay-1',
    supplierId: 's1',
    bankAccountId: 'bank-1',
    documentStatus: 'APPROVED',
    postingStatus: 'NOT_POSTED',
    currencyCode: 'USD',
    paymentDate: new Date('2026-02-01'),
    accountingDate: new Date('2026-01-31'),
    ...over,
  });

  it('partial allocation → Dr AP (allocated) / Dr Advance (unallocated) / Cr Bank (total), on accountingDate', async () => {
    const { svc, captured } = buildPost(
      postedPayment({
        totalAmount: new Decimal(1200),
        allocatedAmount: new Decimal(1000),
        unallocatedAmount: new Decimal(200),
      }),
    );

    await svc.post(identity, { paymentId: 'pay-1', ...postDto });

    const cmd = captured.post!;
    expect(cmd.eventType).toBe('EVT-AP-003');
    // Accounting-date rule: posting uses the payment's accountingDate, never new Date().
    expect((cmd.accountingDate as Date).toISOString().slice(0, 10)).toBe('2026-01-31');
    expect(lineFor(cmd, 'acct-21000')!.debitAmount.toFixed(2)).toBe('1000.00'); // AP
    expect(lineFor(cmd, 'acct-13000')!.debitAmount.toFixed(2)).toBe('200.00'); // Supplier Advance
    expect(lineFor(cmd, 'acct-10200')!.creditAmount.toFixed(2)).toBe('1200.00'); // Bank
  });

  it('fully allocated → Dr AP / Cr Bank, no advance leg', async () => {
    const { svc, captured } = buildPost(
      postedPayment({
        totalAmount: new Decimal(1000),
        allocatedAmount: new Decimal(1000),
        unallocatedAmount: new Decimal(0),
      }),
    );

    await svc.post(identity, { paymentId: 'pay-1', ...postDto });

    const cmd = captured.post!;
    expect(lineFor(cmd, 'acct-21000')!.debitAmount.toFixed(2)).toBe('1000.00');
    expect(lineFor(cmd, 'acct-13000')).toBeUndefined();
    expect(lineFor(cmd, 'acct-10200')!.creditAmount.toFixed(2)).toBe('1000.00');
  });

  it('pure advance (nothing allocated) → Dr Advance / Cr Bank, no AP leg', async () => {
    const { svc, captured } = buildPost(
      postedPayment({
        totalAmount: new Decimal(750),
        allocatedAmount: new Decimal(0),
        unallocatedAmount: new Decimal(750),
      }),
    );

    await svc.post(identity, { paymentId: 'pay-1', ...postDto });

    const cmd = captured.post!;
    expect(lineFor(cmd, 'acct-21000')).toBeUndefined();
    expect(lineFor(cmd, 'acct-13000')!.debitAmount.toFixed(2)).toBe('750.00');
    expect(lineFor(cmd, 'acct-10200')!.creditAmount.toFixed(2)).toBe('750.00');
  });
});
