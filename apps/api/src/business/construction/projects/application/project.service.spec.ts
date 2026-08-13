import { ContractStatus, ProjectStatus } from '@prisma/client';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

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
});
