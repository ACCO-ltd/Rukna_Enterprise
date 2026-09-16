import { ForbiddenException } from '@nestjs/common';
import { InvoiceTemplate } from '@erp/types';

import { OrganizationsService } from './organizations.service.js';
import { OrganizationEntity } from '../domain/entities/organization.entity.js';
import type {
  IOrganizationsRepository,
  OrganizationBrandingPatch,
} from '../domain/interfaces/organizations-repository.interface.js';

function build() {
  const branded = new OrganizationEntity(
    'org-1',
    'ACCO',
    'acco',
    'ACTIVE' as never,
    new Date(),
    new Date(),
    'file-1',
    '123 Main St',
    'TAX-1',
    '#1E40AF',
    'Thank you for your business',
    InvoiceTemplate.STANDARD,
  );

  const repository: jest.Mocked<IOrganizationsRepository> = {
    findById: jest.fn(),
    findBySlug: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    updateBranding: jest.fn().mockResolvedValue(branded),
  };
  const files = { bind: jest.fn().mockResolvedValue(undefined) };

  const service = new OrganizationsService(repository, files as never);
  return { service, repository, files, branded };
}

describe('OrganizationsService.updateBranding', () => {
  it('refuses to brand another organization — the URL id and the caller tenant must agree', async () => {
    const { service, repository } = build();
    const patch: OrganizationBrandingPatch = { legalAddress: 'x' };

    await expect(service.updateBranding('org-2', 'org-1', patch)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.updateBranding).not.toHaveBeenCalled();
  });

  it('binds a newly-supplied logo file (TEMPORARY -> BOUND)', async () => {
    const { service, files } = build();
    await service.updateBranding('org-1', 'org-1', { logoFileId: 'file-1' });

    expect(files.bind).toHaveBeenCalledWith('file-1', expect.stringContaining('org-1'));
  });

  it('does not touch file binding when the patch never mentions a logo', async () => {
    const { service, files } = build();
    await service.updateBranding('org-1', 'org-1', { brandColorHex: '#000000' });

    expect(files.bind).not.toHaveBeenCalled();
  });

  it('leaves an already-bound logo alone when the patch clears it (null, not a new file)', async () => {
    const { service, files } = build();
    await service.updateBranding('org-1', 'org-1', { logoFileId: null });

    expect(files.bind).not.toHaveBeenCalled();
  });
});
