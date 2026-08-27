import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { ExtensionOfTimeService } from './extension-of-time.service.js';

const identity = {
  userId: 'u1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
} as never;

type ContractRow = {
  id: string;
  organizationId: string;
  status: string;
  expectedEndDate: Date | null;
};

function build(
  opts: {
    contract?: ContractRow | null;
    contractVos?: Array<{ id: string }>;
    assertContract?: jest.Mock;
  } = {},
) {
  const contract: ContractRow | null =
    opts.contract === undefined
      ? {
          id: 'c-1',
          organizationId: 'org-1',
          status: 'ACTIVE',
          expectedEndDate: new Date('2027-01-01T00:00:00.000Z'),
        }
      : opts.contract;

  // The row create() records — captured so the test can assert what was written.
  const captured: { create?: Record<string, unknown>; endDate?: Date } = {};

  const prisma = { $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb({})) };
  const tenancy = { getClient: () => prisma } as never;

  const repo = {
    findContract: jest.fn(async () => contract),
    findVariationOrdersForContract: jest.fn(async () => opts.contractVos ?? []),
    updateContractEndDate: jest.fn(async (_tx: unknown, _id: string, newEndDate: Date) => {
      captured.endDate = newEndDate;
      return { id: 'c-1', expectedEndDate: newEndDate };
    }),
    create: jest.fn(async (_tx: unknown, data: Record<string, unknown>) => {
      captured.create = data;
      return {
        id: 'eot-1',
        contractId: data.contractId,
        previousEndDate: data.previousEndDate,
        newEndDate: data.newEndDate,
        grantedDays: data.grantedDays,
        reason: data.reason,
        grantedBy: data.grantedBy,
        grantedAt: data.grantedAt,
        createdAt: new Date('2026-08-27T10:00:00.000Z'),
        citedVariationOrders: (data.citedVariationOrderIds as string[]).map((id) => ({
          id,
          reference: `VO-${id}`,
          status: 'CLIENT_APPROVED',
        })),
      };
    }),
    findByContract: jest.fn(async () => []),
  };

  const projectAccess = {
    assertContract: opts.assertContract ?? jest.fn().mockResolvedValue(undefined),
  };
  const auditOutbox = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new ExtensionOfTimeService(
    tenancy,
    repo as never,
    projectAccess as never,
    auditOutbox as never,
  );
  return { service, repo, projectAccess, auditOutbox, prisma, captured };
}

describe('ExtensionOfTimeService — grant command (CONST-VAR-009)', () => {
  it('updates Contract.expectedEndDate to the supplied newEndDate, writes the EoT row and an audit event', async () => {
    const { service, repo, auditOutbox, captured } = build();

    const res = await service.grant(identity, 'c-1', {
      newEndDate: '2027-03-31',
      reason: 'Client-requested extra floor delayed handover',
    });

    // The contract's contractual completion date moved to the SUPPLIED date (accounting-date rule).
    expect(repo.updateContractEndDate).toHaveBeenCalledWith(
      expect.anything(),
      'c-1',
      new Date('2027-03-31'),
    );
    expect(captured.endDate).toEqual(new Date('2027-03-31'));

    // The EoT row captured the previous → new dates.
    expect(res.previousEndDate).toBe('2027-01-01');
    expect(res.newEndDate).toBe('2027-03-31');

    // A business audit event recorded old→new + reason + actor.
    expect(auditOutbox.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        resourceType: 'Contract',
        resourceId: 'c-1',
        eventType: 'CONTRACT_EXPECTED_END_DATE_EXTENDED',
        sourceCommand: 'contract.grantExtensionOfTime',
        reason: 'Client-requested extra floor delayed handover',
        before: { expectedEndDate: '2027-01-01' },
        after: expect.objectContaining({ expectedEndDate: '2027-03-31' }),
      }),
    );
  });

  it('derives grantedDays from previous→new (2027-01-01 → 2027-01-31 = 30)', async () => {
    const { service } = build();
    const res = await service.grant(identity, 'c-1', {
      newEndDate: '2027-01-31',
      reason: 'Weather delay',
    });
    expect(res.grantedDays).toBe(30);
  });

  it('grantedDays is null when the contract had no previous end date', async () => {
    const { service } = build({
      contract: { id: 'c-1', organizationId: 'org-1', status: 'ACTIVE', expectedEndDate: null },
    });
    const res = await service.grant(identity, 'c-1', {
      newEndDate: '2027-06-30',
      reason: 'First completion date set via EoT',
    });
    expect(res.grantedDays).toBeNull();
    expect(res.previousEndDate).toBeNull();
  });

  it('does NOT auto-apply a VO proposed time impact — the date only moves by the supplied newEndDate', async () => {
    // A cited VO exists (its proposedTimeImpactDays is irrelevant to the effect). The date the command
    // sets is exactly the supplied newEndDate, never derived from any VO.
    const { service, captured } = build({ contractVos: [{ id: 'vo-1' }] });
    const res = await service.grant(identity, 'c-1', {
      newEndDate: '2027-02-15',
      reason: 'Cite VO-1 as justification',
      variationOrderIds: ['vo-1'],
    });
    expect(res.newEndDate).toBe('2027-02-15');
    expect(captured.endDate).toEqual(new Date('2027-02-15'));
    // The cited VO is recorded as justification, not consumed as an effect.
    expect(res.citedVariationOrders.map((v) => v.id)).toEqual(['vo-1']);
  });
});

describe('ExtensionOfTimeService — cited-VO integrity (CONST-VAR-009)', () => {
  it('rejects with 400 when a cited VO does not belong to this contract', async () => {
    // Requested two VOs; the contract-scoped lookup finds only one.
    const { service, repo } = build({ contractVos: [{ id: 'vo-1' }] });
    await expect(
      service.grant(identity, 'c-1', {
        newEndDate: '2027-02-15',
        reason: 'x',
        variationOrderIds: ['vo-1', 'vo-from-another-contract'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // No write happens when integrity fails.
    expect(repo.updateContractEndDate).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('accepts when every cited VO belongs to the contract', async () => {
    const { service } = build({ contractVos: [{ id: 'vo-1' }, { id: 'vo-2' }] });
    const res = await service.grant(identity, 'c-1', {
      newEndDate: '2027-02-15',
      reason: 'both belong',
      variationOrderIds: ['vo-1', 'vo-2'],
    });
    expect(res.citedVariationOrders.map((v) => v.id).sort()).toEqual(['vo-1', 'vo-2']);
  });
});

describe('ExtensionOfTimeService — contract-state guard (CONST-VAR-009)', () => {
  it('rejects a terminal contract (CLOSED) with 409 and writes nothing', async () => {
    const { service, repo } = build({
      contract: { id: 'c-1', organizationId: 'org-1', status: 'CLOSED', expectedEndDate: new Date('2027-01-01') },
    });
    await expect(
      service.grant(identity, 'c-1', { newEndDate: '2027-03-31', reason: 'too late' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.updateContractEndDate).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a not-yet-executed contract (DRAFT) with 409', async () => {
    const { service } = build({
      contract: { id: 'c-1', organizationId: 'org-1', status: 'DRAFT', expectedEndDate: null },
    });
    await expect(
      service.grant(identity, 'c-1', { newEndDate: '2027-03-31', reason: 'not yet' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows FINAL_ACCOUNT_PENDING', async () => {
    const { service } = build({
      contract: {
        id: 'c-1',
        organizationId: 'org-1',
        status: 'FINAL_ACCOUNT_PENDING',
        expectedEndDate: new Date('2027-01-01T00:00:00.000Z'),
      },
    });
    const res = await service.grant(identity, 'c-1', { newEndDate: '2027-02-01', reason: 'ok' });
    expect(res.newEndDate).toBe('2027-02-01');
  });
});

describe('ExtensionOfTimeService — tenancy / membership isolation', () => {
  it('a non-member cannot grant on another tenant\'s contract (assertContract throws)', async () => {
    const denied = jest.fn().mockRejectedValue(new ForbiddenException());
    const { service, repo } = build({ assertContract: denied });
    await expect(
      service.grant(identity, 'c-1', { newEndDate: '2027-03-31', reason: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.findContract).not.toHaveBeenCalled();
  });

  it('grant fails with 404 when the contract is not found in the caller\'s org', async () => {
    const { service } = build({ contract: null });
    await expect(
      service.grant(identity, 'c-x', { newEndDate: '2027-03-31', reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list returns the history + the contract current end date', async () => {
    const { service } = build();
    const res = await service.listForContract(identity, 'c-1');
    expect(res.contractId).toBe('c-1');
    expect(res.currentEndDate).toBe('2027-01-01');
    expect(res.extensions).toEqual([]);
  });
});
