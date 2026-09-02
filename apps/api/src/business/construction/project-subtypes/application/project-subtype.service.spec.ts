import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProjectCategory, type RequestIdentity } from '@erp/types';

import { ProjectSubtypeService } from './project-subtype.service.js';

const identity: RequestIdentity = {
  userId: 'u-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

function build(over: { existingByName?: unknown; existingById?: unknown } = {}) {
  const repo = {
    list: jest.fn().mockResolvedValue([]),
    findById: jest
      .fn()
      .mockResolvedValue('existingById' in over ? over.existingById : { id: 's-1', status: 'ACTIVE' }),
    findByCategoryAndName: jest
      .fn()
      .mockResolvedValue('existingByName' in over ? over.existingByName : null),
    create: jest.fn().mockResolvedValue({ id: 's-1' }),
    updateStatus: jest.fn().mockResolvedValue({ id: 's-1', status: 'INACTIVE' }),
  };
  const tenancy = { getClient: () => ({}) };
  const service = new ProjectSubtypeService(tenancy as never, repo as never);
  return { repo, service };
}

describe('ProjectSubtypeService (PTD1-PTD5)', () => {
  it('create: trims the name and persists it under the given category', async () => {
    const { repo, service } = build();
    await service.create(identity, { category: ProjectCategory.COMMERCIAL, name: '  Office buildings ' });
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        category: ProjectCategory.COMMERCIAL,
        name: 'Office buildings',
      }),
    );
  });

  it('create: rejects a duplicate name within the same category (409)', async () => {
    const { service } = build({ existingByName: { id: 's-9', name: 'Hotels' } });
    await expect(
      service.create(identity, { category: ProjectCategory.COMMERCIAL, name: 'Hotels' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('deactivate: flips an existing subtype to INACTIVE', async () => {
    const { repo, service } = build();
    await service.deactivate(identity, 's-1');
    expect(repo.updateStatus).toHaveBeenCalledWith(expect.anything(), 's-1', 'INACTIVE');
  });

  it('deactivate: rejects an unknown subtype (404)', async () => {
    const { service } = build({ existingById: null });
    await expect(service.deactivate(identity, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list: forwards the category + activeOnly filter to the repository', async () => {
    const { repo, service } = build();
    await service.list(identity, { category: ProjectCategory.INDUSTRIAL, activeOnly: true });
    expect(repo.list).toHaveBeenCalledWith(expect.anything(), 'org-1', {
      category: ProjectCategory.INDUSTRIAL,
      activeOnly: true,
    });
  });
});
