import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { normalizeSupplierInvoiceNumber } from '../infrastructure/supplier-bill.repository.js';
import { SupplierBillService } from './supplier-bill.service.js';

/**
 * ADR-037 backend fix — one supplier invoice number per supplier.
 *
 * `SupplierBill` carries a unique index on (organizationId, supplierId, supplierInvoiceNumberNorm).
 * `POST /bills` used to hit it unhandled, so a duplicate came back as a raw 500. It is now a 409
 * naming the bill that already holds the number: checked up front, and — for two creates racing
 * past the pre-check — caught from the index as a fallback.
 */

const identity = { userId: 'u1', activeOrganizationId: 'o1', roles: [], permissions: [] } as never;

// A non-PO bill with no project: the corporate attribution, so cost-target validation passes
// without touching the database and the test reaches the duplicate check.
const DTO = {
  supplierId: 's1',
  supplierInvoiceNumber: 'INV-0042',
  billDate: '2026-09-01',
  dueDate: '2026-10-01',
  currencyCode: 'USD',
  lines: [
    { description: 'Office rent', netAmount: 400, vatAmount: 0, expenseProfileCode: 'OFFICE_EXPENSE' },
  ],
};

function uniqueViolation(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

function build(existing: { id: string; billNumber: string | null } | null) {
  const repo = {
    findBySupplierInvoiceNumber: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockResolvedValue({ id: 'b-new' }),
  };
  // The profile-class guard (M1) finds no profile here, so it stays out of this test's way.
  const client = { postingProfile: { findFirst: jest.fn().mockResolvedValue(null) } };
  const tenancy = { getClient: () => client } as never;
  const svc = new SupplierBillService(
    tenancy,
    repo as never,
    {} as never, // accountRepo
    {} as never, // sequenceRepo
    {} as never, // postingPort
    {} as never, // commitmentWriter
    {} as never, // billMatching
    {} as never, // commandGovernance
    {} as never, // sod
  );
  return { svc, repo };
}

describe('SupplierBillService.create — duplicate supplier invoice number', () => {
  it('creates the bill when the supplier has no bill with that number', async () => {
    const { svc, repo } = build(null);

    await expect(svc.create(identity, DTO)).resolves.toEqual({ id: 'b-new' });
    expect(repo.findBySupplierInvoiceNumber).toHaveBeenCalledWith(expect.anything(), 'o1', 's1', 'INV-0042');
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('refuses with 409 naming the posted bill that already holds the number', async () => {
    const { svc, repo } = build({ id: 'b1', billNumber: 'BILL-2026-0042' });

    const attempt = svc.create(identity, DTO);
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.create(identity, DTO)).rejects.toThrow(
      'Supplier invoice INV-0042 is already recorded on BILL-2026-0042',
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('names "a draft bill" when the holder has no number yet (numbers are assigned at post)', async () => {
    const { svc } = build({ id: 'b1', billNumber: null });

    await expect(svc.create(identity, DTO)).rejects.toThrow(
      'Supplier invoice INV-0042 is already recorded on a draft bill',
    );
  });

  it('turns a racing create that loses at the unique index into the same 409', async () => {
    const { svc, repo } = build(null);
    repo.create.mockRejectedValueOnce(
      uniqueViolation(['organizationId', 'supplierId', 'supplierInvoiceNumberNorm']),
    );
    // The winner is visible by the time the fallback looks it up.
    repo.findBySupplierInvoiceNumber
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'b-winner', billNumber: null });

    await expect(svc.create(identity, DTO)).rejects.toThrow(
      new ConflictException('Supplier invoice INV-0042 is already recorded on a draft bill'),
    );
  });

  it('lets any other database error through unchanged', async () => {
    const { svc, repo } = build(null);
    const other = uniqueViolation(['someOtherColumn']);
    repo.create.mockRejectedValueOnce(other);

    await expect(svc.create(identity, DTO)).rejects.toBe(other);
  });
});

describe('normalizeSupplierInvoiceNumber', () => {
  it('trims, upper-cases and strips everything but letters and digits', () => {
    expect(normalizeSupplierInvoiceNumber('  inv-0042 ')).toBe('INV0042');
    expect(normalizeSupplierInvoiceNumber('BCC/INV/5531')).toBe('BCCINV5531');
    expect(normalizeSupplierInvoiceNumber('inv 0042')).toBe(normalizeSupplierInvoiceNumber('INV-0042'));
  });
});
