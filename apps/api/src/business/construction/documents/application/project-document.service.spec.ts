import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { ProjectDocumentService } from './project-document.service.js';

const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

function build(over: { file?: unknown; owned?: unknown } = {}) {
  const repo = {
    findFileStatus: jest.fn().mockResolvedValue('file' in over ? over.file : { id: 'f-1', status: 'READY' }),
    create: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    findByProject: jest.fn().mockResolvedValue([{ id: 'doc-1' }]),
    findOwned: jest.fn().mockResolvedValue('owned' in over ? over.owned : { id: 'doc-1' }),
    delete: jest.fn().mockResolvedValue({ id: 'doc-1' }),
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  const tenancy = { getClient: () => ({}) };
  const service = new ProjectDocumentService(tenancy as never, repo as never, projectAccess as never);
  return { repo, projectAccess, service };
}

const dto = { platformFileId: 'f-1', category: 'PERMIT' as never, title: 'Building permit' };

describe('ProjectDocumentService (Documents tab)', () => {
  it('attach: links a READY file to the project', async () => {
    const { repo, projectAccess, service } = build();
    await service.attach(identity, 'p-1', dto);
    expect(projectAccess.assertMember).toHaveBeenCalledWith(identity, 'p-1');
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: 'p-1', platformFileId: 'f-1', category: 'PERMIT', title: 'Building permit' }),
    );
  });

  it('attach: rejects a file that is not READY (still uploading)', async () => {
    const { repo, service } = build({ file: { id: 'f-1', status: 'PENDING' } });
    await expect(service.attach(identity, 'p-1', dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('attach: rejects an unknown / cross-tenant file', async () => {
    const { service } = build({ file: null });
    await expect(service.attach(identity, 'p-1', dto)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove: rejects a document that does not belong to the project (404, no delete)', async () => {
    const { repo, service } = build({ owned: null });
    await expect(service.remove(identity, 'p-1', 'foreign')).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('list: returns the project documents', async () => {
    const { service } = build();
    const res = await service.list(identity, 'p-1');
    expect(res).toHaveLength(1);
  });
});
