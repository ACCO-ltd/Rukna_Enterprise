import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { SupplierPaymentService } from './supplier-payment.service.js';

/**
 * ADR-022 CONST-DOA-005 — bank-signatory dual control on payment release. Release is distinct from
 * approval: only authorized signatories of the payment's account may sign, the approver may not
 * also release, and two distinct signatures are required to reach RELEASED. An account without
 * signatories is not under dual control and keeps the APPROVED → post path.
 */
const identity = (userId: string) =>
  ({ userId, activeOrganizationId: 'o1', roles: [], permissions: [] }) as never;

function build(over: {
  payment?: Record<string, unknown>;
  isSignatory?: boolean;
  requiresDualControl?: boolean;
  signatureCount?: number;
  addThrows?: unknown;
} = {}) {
  const payment = over.payment ?? {
    id: 'p1',
    documentStatus: 'APPROVED',
    bankAccountId: 'bank-1',
    approvedBy: 'finance-officer',
  };
  const paymentRepo = {
    findById: jest.fn().mockResolvedValue(payment),
    addReleaseSignature: over.addThrows
      ? jest.fn().mockRejectedValue(over.addThrows)
      : jest.fn().mockResolvedValue({ id: 'sig-1' }),
    countReleaseSignatures: jest.fn().mockResolvedValue(over.signatureCount ?? 1),
    markReleased: jest.fn().mockResolvedValue({ ...payment, documentStatus: 'RELEASED' }),
  };
  const prisma = {
    supplierPaymentAllocation: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: async (cb: (tx: unknown) => unknown) => cb(prisma),
  };
  const signatoryService = {
    isActiveSignatory: jest.fn().mockResolvedValue(over.isSignatory ?? true),
    requiresDualControl: jest.fn().mockResolvedValue(over.requiresDualControl ?? true),
  };
  const sod = { assertAllowed: jest.fn() };
  const svc = new SupplierPaymentService(
    { getClient: () => prisma } as never,
    paymentRepo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    sod as never,
    signatoryService as never,
  );
  return { svc, paymentRepo, signatoryService };
}

describe('SupplierPaymentService.signRelease (ADR-022 CONST-DOA-005)', () => {
  it('rejects a non-signatory', async () => {
    const { svc } = build({ isSignatory: false });
    await expect(svc.signRelease(identity('outsider'), 'p1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects the payment approver signing their own release (SoD)', async () => {
    const { svc } = build({ isSignatory: true });
    await expect(svc.signRelease(identity('finance-officer'), 'p1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects releasing a payment that is not APPROVED', async () => {
    const { svc } = build({ payment: { id: 'p1', documentStatus: 'DRAFT', bankAccountId: 'bank-1', approvedBy: 'x' } });
    await expect(svc.signRelease(identity('signer-1'), 'p1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the first signature records but does not release (needs two)', async () => {
    const { svc, paymentRepo } = build({ signatureCount: 1 });
    await svc.signRelease(identity('signer-1'), 'p1');
    expect(paymentRepo.addReleaseSignature).toHaveBeenCalledWith(expect.anything(), 'p1', 'signer-1');
    expect(paymentRepo.markReleased).not.toHaveBeenCalled();
  });

  it('the second distinct signature releases the payment', async () => {
    const { svc, paymentRepo } = build({ signatureCount: 2 });
    await svc.signRelease(identity('signer-2'), 'p1');
    expect(paymentRepo.markReleased).toHaveBeenCalledWith(expect.anything(), 'p1');
  });

  it('rejects a signatory signing twice', async () => {
    const dup = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    const { svc } = build({ addThrows: dup });
    await expect(svc.signRelease(identity('signer-1'), 'p1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('SupplierPaymentService.post — dual-control guard (ADR-022 CONST-DOA-005)', () => {
  it('blocks posting an APPROVED payment when the account is under dual control', async () => {
    const { svc } = build({ requiresDualControl: true, payment: { id: 'p1', documentStatus: 'APPROVED', bankAccountId: 'bank-1', postingStatus: 'NOT_POSTED', approvedBy: 'x' } });
    await expect(
      svc.post(identity('poster'), { paymentId: 'p1', apAccountCode: '20000', bankGlCode: '10000', supplierAdvanceCode: '13000' }),
    ).rejects.toThrow(/RELEASED/);
  });

  it('allows an account with no signatories to post from APPROVED (unchanged)', async () => {
    // requiresDualControl false → the guard falls through to the pre-Phase-4 APPROVED check, which
    // passes; the call then proceeds into GL work (out of scope here) so we only assert it is not
    // the dual-control rejection.
    const { svc } = build({ requiresDualControl: false, payment: { id: 'p1', documentStatus: 'APPROVED', bankAccountId: 'bank-1', postingStatus: 'NOT_POSTED', approvedBy: 'x' } });
    await expect(
      svc.post(identity('poster'), { paymentId: 'p1', apAccountCode: '20000', bankGlCode: '10000', supplierAdvanceCode: '13000' }),
    ).rejects.not.toThrow(/RELEASED/);
  });
});
