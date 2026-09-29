import { UomService } from './uom.service.js';
import { UomRepository } from '../infrastructure/uom.repository.js';
import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { RequestIdentity } from '@erp/types';

describe('UomService.listLookup', () => {
  const prisma = { tag: 'tenant-client' };
  const tenancy = { getClient: jest.fn(() => prisma) } as unknown as TenancyService;
  const findLookup = jest.fn();
  const repo = { findLookup } as unknown as UomRepository;
  const service = new UomService(tenancy, repo);
  const identity = { userId: 'u1', activeOrganizationId: 'org-acco' } as RequestIdentity;

  beforeEach(() => findLookup.mockReset().mockResolvedValue([]));

  it('scopes the read to the caller’s active organization, ACTIVE by default', async () => {
    await service.listLookup(identity);
    expect(findLookup).toHaveBeenCalledWith(prisma, 'org-acco', 'ACTIVE');
  });

  it('passes an explicit status through', async () => {
    await service.listLookup(identity, 'INACTIVE');
    expect(findLookup).toHaveBeenCalledWith(prisma, 'org-acco', 'INACTIVE');
  });

  it('returns the repository projection unchanged', async () => {
    findLookup.mockResolvedValue([{ code: 'M2', name: 'Square metre', symbol: 'm²' }]);
    await expect(service.listLookup(identity)).resolves.toEqual([
      { code: 'M2', name: 'Square metre', symbol: 'm²' },
    ]);
  });
});

describe('UomRepository.findLookup', () => {
  it('filters by organization and status and selects only code, name and symbol', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { unitOfMeasure: { findMany } };
    await new UomRepository().findLookup(prisma as never, 'org-acco', 'ACTIVE');
    expect(findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-acco', status: 'ACTIVE' },
      select: { code: true, name: true, symbol: true },
      orderBy: { code: 'asc' },
    });
  });
});
