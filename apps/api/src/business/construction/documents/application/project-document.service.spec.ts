import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { ProjectDocumentService } from './project-document.service.js';

const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

const READY_FILE = { id: 'f-1', status: 'READY', lifecycle: 'TEMPORARY', uploadedBy: 'user-1' };
const OWNED_DOC = {
  id: 'doc-1',
  platformFileId: 'f-1',
  platformFile: { lifecycle: 'BOUND' },
};

function build(over: { file?: unknown; owned?: unknown } = {}) {
  const repo = {
    findFileStatus: jest.fn().mockResolvedValue('file' in over ? over.file : READY_FILE),
    create: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    findByProject: jest.fn().mockResolvedValue([{ id: 'doc-1' }]),
    findOwned: jest.fn().mockResolvedValue('owned' in over ? over.owned : OWNED_DOC),
    delete: jest.fn().mockResolvedValue({ id: 'doc-1' }),
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  const files = {
    bind: jest.fn().mockResolvedValue(undefined),
    discardIfUnreferenced: jest.fn().mockResolvedValue(true),
  };
  const tenancy = { getClient: () => ({}) };
  const service = new ProjectDocumentService(
    tenancy as never,
    repo as never,
    projectAccess as never,
    files as never,
  );
  return { repo, projectAccess, files, service };
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

  /**
   * Binding is what takes the file out of reach of the abandoned-upload sweep and of
   * `DELETE /files/:id`. An attach that skipped it would leave live evidence reapable.
   */
  it('attach: binds the file to the document it just created', async () => {
    const { files, service } = build();
    await service.attach(identity, 'p-1', dto);
    expect(files.bind).toHaveBeenCalledWith('f-1', expect.stringContaining('doc-1'));
  });

  /** Two records sharing one file means one record's deletion silently breaks the other. */
  it('attach: rejects a file another record already owns', async () => {
    const { repo, service } = build({ file: { ...READY_FILE, lifecycle: 'BOUND' } });
    await expect(service.attach(identity, 'p-1', dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('attach: rejects a file somebody else uploaded', async () => {
    const { repo, service } = build({ file: { ...READY_FILE, uploadedBy: 'someone-else' } });
    await expect(service.attach(identity, 'p-1', dto)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  /**
   * Audit P1-2: removal used to delete the register row and leave the file and its bytes behind
   * for good. The register owns its files' lifecycle, so it discards them too.
   */
  it('remove: discards the file along with the document', async () => {
    const { repo, files, service } = build();
    await service.remove(identity, 'p-1', 'doc-1');
    expect(repo.delete).toHaveBeenCalledWith(expect.anything(), 'doc-1');
    expect(files.discardIfUnreferenced).toHaveBeenCalledWith('f-1');
  });

  it('remove: refuses to detach a finalised document', async () => {
    const { repo, files, service } = build({
      owned: { ...OWNED_DOC, platformFile: { lifecycle: 'IMMUTABLE' } },
    });
    await expect(service.remove(identity, 'p-1', 'doc-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.delete).not.toHaveBeenCalled();
    expect(files.discardIfUnreferenced).not.toHaveBeenCalled();
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
