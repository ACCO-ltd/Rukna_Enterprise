import { ConflictException, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { DistrictService } from './district.service.js';

const identity: RequestIdentity = {
  userId: 'u-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

function build(over: { existingByCode?: unknown; existingById?: unknown } = {}) {
  const repo = {
    list: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue('existingById' in over ? over.existingById : { id: 'd-1' }),
    findByCode: jest.fn().mockResolvedValue('existingByCode' in over ? over.existingByCode : null),
    create: jest.fn().mockResolvedValue({ id: 'd-1' }),
    update: jest.fn().mockResolvedValue({ id: 'd-1' }),
  };
  const tenancy = { getClient: () => ({}) };
  const service = new DistrictService(tenancy as never, repo as never);
  return { repo, service };
}

describe('DistrictService (ADR-025)', () => {
  it('create: upper-cases and trims the code', async () => {
    const { repo, service } = build();
    await service.create(identity, { code: ' wbr ', name: '  Waaberi ' });
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'WBR', name: 'Waaberi', organizationId: 'org-1' }),
    );
  });

  it('create: rejects a duplicate code', async () => {
    const { service } = build({ existingByCode: { id: 'd-9', code: 'WBR' } });
    await expect(service.create(identity, { code: 'WBR', name: 'Waaberi' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('update: rejects an unknown district', async () => {
    const { service } = build({ existingById: null });
    await expect(service.update(identity, 'nope', { name: 'X' })).rejects.toThrow(NotFoundException);
  });

  it('update: passes through name and active only when provided', async () => {
    const { repo, service } = build();
    await service.update(identity, 'd-1', { active: false });
    expect(repo.update).toHaveBeenCalledWith(expect.anything(), 'd-1', { active: false });
  });

  it('list: forwards the activeOnly filter', async () => {
    const { repo, service } = build();
    await service.list(identity, true);
    expect(repo.list).toHaveBeenCalledWith(expect.anything(), 'org-1', true);
  });
});
