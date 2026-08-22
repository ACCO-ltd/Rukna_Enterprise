import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { ReceiptExceptionService } from './receipt-exception.service.js';

/**
 * ADR-022 CONST-DOA-004 — the PO-creator-receipt exception. Request derives the receiver from the
 * PO creator; an independent supervisor (≠ receiver) verifies; the CFO (≠ receiver, ≠ supervisor)
 * approves. Only an APPROVED exception clears the receiver.
 */
const identity = (userId: string, roles: string[] = []) =>
  ({ userId, activeOrganizationId: 'o1', roles }) as never;

function build(over: { exception?: Record<string, unknown> | null; po?: unknown } = {}) {
  const repo = {
    findById: jest.fn().mockResolvedValue('exception' in over ? over.exception : null),
    create: jest.fn().mockResolvedValue({ id: 'ex-1' }),
    updateStatus: jest.fn().mockImplementation((_p, id, data) => Promise.resolve({ id, ...data })),
    listByPo: jest.fn().mockResolvedValue([]),
    hasApprovedException: jest.fn().mockResolvedValue(false),
  };
  const poRepo = {
    findById: jest.fn().mockResolvedValue('po' in over ? over.po : { id: 'po1', createdBy: 'creator' }),
  };
  const tenancy = { getClient: () => ({}) } as never;
  const svc = new ReceiptExceptionService(tenancy, repo as never, poRepo as never);
  return { svc, repo, poRepo };
}

describe('ReceiptExceptionService (ADR-022 CONST-DOA-004)', () => {
  it('request records the exception for the PO creator as receiver', async () => {
    const { svc, repo } = build();
    await svc.request(identity('storekeeper'), 'po1', 'staffing shortage');
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ purchaseOrderId: 'po1', receiverUserId: 'creator', requestedBy: 'storekeeper' }),
    );
  });

  it('request 404s for an unknown PO', async () => {
    const { svc } = build({ po: null });
    await expect(svc.request(identity('x'), 'nope', 'y')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('verify: the receiver cannot verify their own exception', async () => {
    const { svc } = build({ exception: { id: 'ex-1', status: 'PENDING', receiverUserId: 'creator' } });
    await expect(svc.verify(identity('creator'), 'ex-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('verify: an independent supervisor moves it to SUPERVISOR_VERIFIED', async () => {
    const { svc, repo } = build({ exception: { id: 'ex-1', status: 'PENDING', receiverUserId: 'creator' } });
    await svc.verify(identity('supervisor'), 'ex-1');
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.anything(),
      'ex-1',
      expect.objectContaining({ status: 'SUPERVISOR_VERIFIED', supervisorUserId: 'supervisor' }),
    );
  });

  it('verify: rejects when not PENDING', async () => {
    const { svc } = build({ exception: { id: 'ex-1', status: 'APPROVED', receiverUserId: 'creator' } });
    await expect(svc.verify(identity('supervisor'), 'ex-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  const verified = { id: 'ex-1', status: 'SUPERVISOR_VERIFIED', receiverUserId: 'creator', supervisorUserId: 'supervisor' };

  it('approve: non-CFO is forbidden', async () => {
    const { svc } = build({ exception: verified });
    await expect(svc.approve(identity('someone'), 'ex-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approve: the receiver (even as CFO) cannot approve', async () => {
    const { svc } = build({ exception: { ...verified, receiverUserId: 'cfo' } });
    await expect(svc.approve(identity('cfo', ['CFO']), 'ex-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approve: the verifying supervisor cannot also approve', async () => {
    const { svc } = build({ exception: { ...verified, supervisorUserId: 'cfo' } });
    await expect(svc.approve(identity('cfo', ['CFO']), 'ex-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approve: a distinct CFO approves the exception', async () => {
    const { svc, repo } = build({ exception: verified });
    await svc.approve(identity('cfo', ['CFO']), 'ex-1');
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.anything(),
      'ex-1',
      expect.objectContaining({ status: 'APPROVED', cfoUserId: 'cfo' }),
    );
  });
});
