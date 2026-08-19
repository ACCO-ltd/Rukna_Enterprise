import { NotFoundException } from '@nestjs/common';
import { ContractStatus, ProjectStatus } from '@prisma/client';
import { PERMISSIONS, ProjectRole, type RequestIdentity } from '@erp/types';

import { ProjectService } from './project.service';

const identity = (permissions: string[]): RequestIdentity => ({
  userId: 'user-1',
  tenantSlug: 'acco',
  activeOrganizationId: 'org-1',
  roles: [],
  permissions,
  lang: 'en',
});

const workspaceRecord = {
  id: 'project-1',
  organizationId: 'org-1',
  commercialModel: 'CLIENT_CONTRACT',
  startDate: new Date('2026-02-01T00:00:00.000Z'),
  expectedEndDate: new Date('2027-08-31T00:00:00.000Z'),
  suspensions: [],
  members: [
    {
      user: { id: 'user-1', firstName: 'Ahmed', lastName: 'Hassan' },
      roles: [{ role: 'PROJECT_MANAGER' }],
    },
    {
      user: { id: 'user-2', firstName: 'Asha', lastName: 'Ali' },
      roles: [{ role: 'SITE_ENGINEER' }],
    },
  ],
  boq: { id: 'boq-1', versions: [{ status: 'BASELINED' }] },
  contracts: [
    {
      id: 'contract-1',
      contractNumber: 'CTR-001',
      contractValue: '12500000.00',
      currency: 'USD',
      status: ContractStatus.ACTIVE,
      startDate: null,
      expectedEndDate: null,
    },
  ],
  status: ProjectStatus.DRAFT,
};

describe('ProjectService workspace summary', () => {
  const projectAccess = { assertMember: jest.fn() };
  const repo = {
    findWorkspaceSummary: jest.fn(),
    findRecentProjectActivity: jest.fn(),
  };
  const tenancy = { getClient: jest.fn(() => ({ marker: 'tenant-client' })) };
  const service = new ProjectService(
    tenancy as never,
    {} as never,
    repo as never,
    {} as never,
    projectAccess as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    projectAccess.assertMember.mockResolvedValue(undefined);
    repo.findWorkspaceSummary.mockResolvedValue(workspaceRecord);
    repo.findRecentProjectActivity.mockResolvedValue([
      {
        id: 'audit-1',
        action: 'CREATE',
        sourceCommand: 'project.create',
        createdAt: new Date('2026-08-13T10:42:00.000Z'),
        user: { id: 'user-1', firstName: 'Ahmed', lastName: 'Hassan' },
      },
    ]);
  });

  it('returns authoritative setup and responsibility projections', async () => {
    const result = await service.getWorkspaceSummary(
      identity([PERMISSIONS.contractsView, PERMISSIONS.financialPositionView]),
      'project-1',
    );

    expect(projectAccess.assertMember).toHaveBeenCalledWith(expect.any(Object), 'project-1');
    expect(repo.findWorkspaceSummary).toHaveBeenCalledWith(
      { marker: 'tenant-client' },
      'org-1',
      'project-1',
    );
    expect(result.setup).toEqual({
      identityComplete: true,
      boqExists: true,
      boqBaselined: true,
      mainContractApplicable: true,
      mainContractExists: true,
      teamReady: true,
      completedSteps: 4,
      totalSteps: 4,
    });
    expect(result.responsibility).toEqual({
      projectManager: { id: 'user-1', name: 'Ahmed Hassan' },
      teamCount: 2,
    });
    expect(result.mainContract?.contractValue).toBe('12500000.00');
    expect(result.recentActivity[0]).toMatchObject({
      action: 'CREATE',
      actor: { name: 'Ahmed Hassan' },
    });
  });

  it('does not disclose main-contract details or value without their permissions', async () => {
    const noContractAccess = await service.getWorkspaceSummary(identity([]), 'project-1');
    expect(noContractAccess.mainContract).toBeNull();
    expect(noContractAccess.financialsVisible).toBe(false);

    const contractOnly = await service.getWorkspaceSummary(
      identity([PERMISSIONS.contractsView]),
      'project-1',
    );
    expect(contractOnly.mainContract).toMatchObject({
      id: 'contract-1',
      contractValue: null,
      currency: null,
    });
  });

  it('orders lifecycle-aware workspace guidance without deriving it in the frontend', async () => {
    repo.findWorkspaceSummary.mockResolvedValue({
      ...workspaceRecord,
      startDate: null,
      expectedEndDate: null,
      suspensions: [{ id: 'suspension-1' }],
      members: workspaceRecord.members.slice(0, 1),
      boq: { id: 'boq-1', versions: [{ status: 'DRAFT' }] },
      contracts: [],
    });

    const result = await service.getWorkspaceGuidance(identity([]), 'project-1');

    expect(result.map((item) => item.kind)).toEqual([
      'PROGRAMME_DATES_MISSING',
      'BOQ_BASELINE_REQUIRED',
      'DELIVERY_TEAM_INCOMPLETE',
      'MAIN_CONTRACT_BLOCKED',
    ]);
    expect(result[0].severity).toBe('WARNING');
    expect(result.at(-1)?.severity).toBe('INFO');
    expect(result.find((item) => item.kind === 'PROGRAMME_DATES_MISSING')?.actionUrl).toBeNull();

    const actionable = await service.getWorkspaceGuidance(
      identity([
        PERMISSIONS.projectsManage,
        PERMISSIONS.boqView,
        PERMISSIONS.contractsCreate,
        PERMISSIONS.projectMembersManage,
      ]),
      'project-1',
    );
    expect(actionable.find((item) => item.kind === 'PROGRAMME_DATES_MISSING')?.actionUrl).toBe(
      '/projects/project-1/edit',
    );
    expect(actionable.find((item) => item.kind === 'DELIVERY_TEAM_INCOMPLETE')?.actionUrl).toBe(
      '/projects/project-1/members',
    );
  });

  it('does not present draft setup guidance for a terminal project', async () => {
    repo.findWorkspaceSummary.mockResolvedValue({
      ...workspaceRecord,
      status: ProjectStatus.CLOSED,
      startDate: null,
      expectedEndDate: null,
      suspensions: [{ id: 'historical-suspension' }],
      members: workspaceRecord.members.slice(0, 1),
      boq: null,
      contracts: [],
    });

    await expect(service.getWorkspaceGuidance(identity([]), 'project-1')).resolves.toEqual([]);
  });
});

describe('ProjectService.setMemberRoles', () => {
  function buildRoleEdit(member: unknown) {
    const repo = {
      findById: jest.fn().mockResolvedValue({ id: 'project-1' }),
      findActiveMember: jest.fn().mockResolvedValue(member),
      deactivateMemberRoles: jest.fn().mockResolvedValue({ count: 1 }),
      addMemberRoles: jest.fn().mockResolvedValue({ count: 1 }),
    };
    // $transaction runs the callback with a throwaway tx client — repo calls are mocked, so the
    // client it receives is irrelevant.
    const prisma = { $transaction: (fn: (tx: unknown) => unknown) => fn({}) };
    const tenancy = { getClient: () => prisma };
    const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(
      tenancy as never,
      {} as never,
      repo as never,
      {} as never,
      projectAccess as never,
      {} as never,
    );
    return { service, repo };
  }

  it('closes the current roles and opens the new set (versioned edit)', async () => {
    const { service, repo } = buildRoleEdit({ id: 'member-1' });

    await service.setMemberRoles(identity([]), 'project-1', 'user-2', {
      roles: [ProjectRole.SITE_ENGINEER, ProjectRole.VIEWER],
    });

    expect(repo.deactivateMemberRoles).toHaveBeenCalledWith(expect.anything(), 'member-1');
    expect(repo.addMemberRoles).toHaveBeenCalledWith(
      expect.anything(),
      'member-1',
      [ProjectRole.SITE_ENGINEER, ProjectRole.VIEWER],
      'user-1',
    );
  });

  it('rejects when the user is not an active member', async () => {
    const { service, repo } = buildRoleEdit(null);

    await expect(
      service.setMemberRoles(identity([]), 'project-1', 'user-2', { roles: [ProjectRole.VIEWER] }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(repo.deactivateMemberRoles).not.toHaveBeenCalled();
    expect(repo.addMemberRoles).not.toHaveBeenCalled();
  });
});
