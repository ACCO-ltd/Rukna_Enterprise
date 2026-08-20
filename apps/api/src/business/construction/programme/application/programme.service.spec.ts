import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { ProgrammeService } from './programme.service.js';

const identity: RequestIdentity = {
  userId: 'u-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
  lang: 'en',
};

function build(over: { milestone?: unknown } = {}) {
  const milestone =
    'milestone' in over ? over.milestone : { id: 'ms-1', projectId: 'p-1', status: 'PLANNED' };
  const repo = {
    createMilestone: jest.fn().mockResolvedValue({ id: 'ms-1' }),
    findMilestones: jest.fn().mockResolvedValue([]),
    findMilestoneById: jest.fn().mockResolvedValue(milestone),
    verifyMilestone: jest.fn().mockResolvedValue({ id: 'ms-1', status: 'VERIFIED' }),
  };
  const tenancy = { getClient: () => ({}) };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  const service = new ProgrammeService(tenancy as never, repo as never, projectAccess as never);
  return { repo, service };
}

describe('ProgrammeService (ADR-021 ph.2 milestones)', () => {
  it('createMilestone: creates a PLANNED milestone with a baseline date', async () => {
    const { repo, service } = build();
    await service.createMilestone(identity, 'p-1', {
      code: 'MS-01',
      name: 'Substructure complete',
      baselineDate: '2026-10-01',
    });
    expect(repo.createMilestone).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: 'p-1',
        code: 'MS-01',
        baselineDate: expect.any(Date),
        createdBy: 'u-1',
      }),
    );
  });

  it('verifyMilestone: verifies a PLANNED milestone with the actual date', async () => {
    const { repo, service } = build();
    await service.verifyMilestone(identity, 'ms-1', { actualDate: '2026-10-03' });
    expect(repo.verifyMilestone).toHaveBeenCalledWith(
      expect.anything(),
      'ms-1',
      expect.any(Date),
      'u-1',
    );
  });

  it('verifyMilestone: rejects a milestone that is not PLANNED', async () => {
    const { repo, service } = build({ milestone: { id: 'ms-1', projectId: 'p-1', status: 'VERIFIED' } });
    await expect(
      service.verifyMilestone(identity, 'ms-1', { actualDate: '2026-10-03' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.verifyMilestone).not.toHaveBeenCalled();
  });

  it('verifyMilestone: 404 when the milestone does not exist', async () => {
    const { service } = build({ milestone: null });
    await expect(
      service.verifyMilestone(identity, 'missing', { actualDate: '2026-10-03' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
