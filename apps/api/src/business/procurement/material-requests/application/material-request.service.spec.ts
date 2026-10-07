import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { MaterialRequestStatus } from '@prisma/client';

import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';
import { MaterialRequestService } from './material-request.service.js';

/**
 * MaterialRequestService.approve — SUBMITTED → APPROVED, with the real SoD evaluator reading an
 * active REQUESTER_CANNOT_APPROVE_OWN_REQUEST rule (ACCO's seeded policy).
 */
const UPDATED_AT = new Date('2026-10-07T09:00:00Z');

const identity = (userId: string) =>
  ({ userId, activeOrganizationId: 'o1', roles: [], permissions: [] }) as never;

function build(status: MaterialRequestStatus, requestedBy = 'alice') {
  const repo = {
    findById: jest
      .fn()
      .mockResolvedValue({ id: 'mr1', mrNumber: 'MR-1', status, requestedBy, projectId: 'p1' }),
    updateStatus: jest
      .fn()
      .mockImplementation(async (_tx, _org, id, _from, to) => ({ id, status: to, updatedAt: UPDATED_AT })),
    // Approval sets each line's approved quantity in the same transaction and re-reads the request.
    approveRequestedQuantities: jest
      .fn()
      .mockImplementation(async (_tx, id) => ({ id, status: 'APPROVED', updatedAt: UPDATED_AT })),
  };
  const audit = { record: jest.fn() };
  const projectAccess = { assertMember: jest.fn() };
  const prisma = {
    $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
    segregationOfDutiesRule: {
      findMany: jest.fn().mockResolvedValue([{ code: 'REQUESTER_CANNOT_APPROVE_OWN_REQUEST' }]),
    },
  };
  const tenancy = { getClient: () => prisma };
  const sod = new SegregationOfDutiesService(tenancy as never);
  const svc = new MaterialRequestService(
    tenancy as never,
    repo as never,
    {} as never,
    {} as never,
    projectAccess as never,
    audit as never,
    sod,
    {} as never,
  );
  return { svc, repo, audit, projectAccess };
}

describe('MaterialRequestService.approve', () => {
  it('moves a SUBMITTED request to APPROVED and audits the transition', async () => {
    const { svc, repo, audit, projectAccess } = build('SUBMITTED');

    await expect(svc.approve(identity('bob'), 'mr1')).resolves.toEqual({
      id: 'mr1',
      status: 'APPROVED',
      updatedAt: UPDATED_AT,
    });

    expect(projectAccess.assertMember).toHaveBeenCalledWith(identity('bob'), 'p1');
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'mr1',
      'SUBMITTED',
      'APPROVED',
      undefined,
    );
    expect(repo.approveRequestedQuantities).toHaveBeenCalledWith(expect.anything(), 'mr1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: 'bob',
        sourceCommand: 'mr.approve',
        eventType: 'MR_APPROVED',
        before: { status: 'SUBMITTED' },
        after: { status: 'APPROVED' },
      }),
    );
  });

  it('refuses with 409 and writes no audit when the request changed meanwhile (cancelled first)', async () => {
    const { svc, repo, audit } = build('SUBMITTED');
    repo.updateStatus.mockResolvedValueOnce(null);

    await expect(svc.approve(identity('bob'), 'mr1')).rejects.toBeInstanceOf(ConflictException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses the requester approving their own request', async () => {
    const { svc, repo, audit } = build('SUBMITTED', 'alice');

    await expect(svc.approve(identity('alice'), 'mr1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.updateStatus).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each<MaterialRequestStatus>(['DRAFT', 'APPROVED', 'CANCELLED', 'FULLY_ORDERED', 'CLOSED'])(
    'refuses to approve a %s request',
    async (status) => {
      const { svc, repo } = build(status);

      await expect(svc.approve(identity('bob'), 'mr1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.updateStatus).not.toHaveBeenCalled();
    },
  );
});
