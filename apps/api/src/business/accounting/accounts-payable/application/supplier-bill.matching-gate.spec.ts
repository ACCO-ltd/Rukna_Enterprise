import { BadRequestException, NotFoundException } from '@nestjs/common';

import { SupplierBillService } from './supplier-bill.service.js';

/**
 * ADR-018/ADR-024 item D — the matching gate has teeth. A procurement-linked bill whose match is an
 * EXCEPTION cannot be posted ("Approve the exception before posting"); once the exception is approved
 * (matchStatus APPROVED_EXCEPTION) the gate lets posting proceed. The control is never auto-rejected
 * (Q5): the bill sits blocked and visible until someone with authority approves.
 *
 * POSTABLE_MATCH_STATUSES = [MATCHED, MATCHED_WITH_TOLERANCE, APPROVED_EXCEPTION]
 * (supplier-bill.service.ts). These tests drive SupplierBillService.post at the gate only: the
 * blocked case throws before any GL work; the postable case is proven to pass the gate by letting the
 * very next step (AP account lookup) throw a distinct sentinel — so a NotFoundException for the AP
 * account, not a BadRequestException for the gate, proves the gate did not block.
 */
const identity = { userId: 'u1', activeOrganizationId: 'o1', roles: [], permissions: [] } as never;

function build(matchStatus: string) {
  const bill = {
    id: 'b1',
    documentStatus: 'APPROVED',
    postingStatus: 'NOT_POSTED',
    purchaseOrderRevisionId: 'rev1', // procurement-linked → the gate applies
    matchStatus,
    lines: [],
    supplierId: 's1',
    billDate: new Date('2026-08-01'),
    currencyCode: 'USD',
    totalAmount: '1000',
  };
  const repo = {
    findById: jest.fn().mockResolvedValue(bill),
    markPostingFailed: jest.fn().mockResolvedValue({}),
  };
  // The AP account lookup is the FIRST step after the gate — throwing a sentinel here proves the gate
  // was passed without running a full posting.
  const accountRepo = { findByCode: jest.fn().mockResolvedValue(null) };
  const tenancy = { getClient: () => ({}) } as never;
  const svc = new SupplierBillService(
    tenancy,
    repo as never,
    accountRepo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, accountRepo };
}

describe('SupplierBillService.post — matching gate (ADR-018/ADR-024 item D)', () => {
  it('blocks posting an out-of-tolerance (EXCEPTION) bill with "Approve the exception before posting"', async () => {
    const { svc, accountRepo } = build('EXCEPTION');
    await expect(svc.post(identity, { billId: 'b1', apAccountCode: '2100' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.post(identity, { billId: 'b1', apAccountCode: '2100' })).rejects.toThrow(
      /Approve the exception before posting/,
    );
    // The gate stops posting before any GL lookup — never auto-rejected, just held.
    expect(accountRepo.findByCode).not.toHaveBeenCalled();
  });

  it('lets an APPROVED_EXCEPTION bill through the gate (posting proceeds past it)', async () => {
    const { svc, accountRepo } = build('APPROVED_EXCEPTION');
    // Passes the gate → reaches the AP account lookup (which returns null → NotFound, a DIFFERENT
    // error than the gate's BadRequest). Reaching this step is the proof.
    await expect(svc.post(identity, { billId: 'b1', apAccountCode: '2100' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(accountRepo.findByCode).toHaveBeenCalled();
  });

  it.each(['MATCHED', 'MATCHED_WITH_TOLERANCE'])(
    'lets a %s bill through the gate',
    async (status) => {
      const { svc, accountRepo } = build(status);
      await expect(svc.post(identity, { billId: 'b1', apAccountCode: '2100' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(accountRepo.findByCode).toHaveBeenCalled();
    },
  );
});
