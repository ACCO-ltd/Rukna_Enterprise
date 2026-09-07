import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ProjectDocumentService } from './project-document.service.js';

/**
 * The register's rules, tested at the seam where they are enforced.
 *
 * These are unit tests over mocked infrastructure, so they prove the *decisions* — which states
 * admit which acts, what freezes when, what the file lifecycle is told. They deliberately do not
 * prove the two partial unique indexes; those are database invariants and are exercised by the
 * migration plus the e2e run, because a mock cannot refuse a second issued revision.
 */

const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [PERMISSIONS.projectDocumentsManage, PERMISSIONS.projectDocumentsIssue],
};

const READY_FILE = { id: 'f-1', status: 'READY', lifecycle: 'TEMPORARY', uploadedBy: 'user-1' };

function platformFile(over: Record<string, unknown> = {}) {
  return {
    id: 'f-1',
    originalName: 'permit.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    status: 'READY',
    lifecycle: 'BOUND',
    ...over,
  };
}

function revision(over: Record<string, unknown> = {}) {
  return {
    id: 'rev-1',
    projectDocumentId: 'doc-1',
    platformFileId: 'f-1',
    revisionNumber: 1,
    revisionCode: 'R00',
    status: 'DRAFT',
    purpose: null,
    notes: null,
    issuedAt: null,
    issuedBy: null,
    supersededAt: null,
    withdrawnAt: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    platformFile: platformFile(),
    ...over,
  };
}

function document(over: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    organizationId: 'org-1',
    projectId: 'p-1',
    documentNumber: 'ACCO-OB-0012',
    documentNumberNormalized: 'ACCO-OB-0012',
    title: 'Building permit',
    category: 'PERMIT_LICENSE',
    discipline: null,
    status: 'DRAFT',
    responsibleUserId: null,
    issuerName: null,
    issuedAt: null,
    validFrom: null,
    expiresAt: null,
    currentRevisionId: 'rev-1',
    supersededByDocumentId: null,
    supersededAt: null,
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawnReason: null,
    archivedAt: null,
    archivedBy: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    currentRevision: revision(),
    supersededBy: null,
    _count: { revisions: 1 },
    ...over,
  };
}

function build(over: {
  doc?: Record<string, unknown>;
  file?: unknown;
  revision?: Record<string, unknown> | null;
  revisionStatuses?: { id: string; status: string; platformFileId: string }[];
  numberClash?: boolean;
  member?: boolean;
  successor?: unknown;
} = {}) {
  const doc = document(over.doc ?? {});
  const repo = {
    findPage: jest.fn().mockResolvedValue({ items: [doc], total: 1 }),
    findOne: jest.fn().mockResolvedValue(doc),
    findInProject: jest.fn().mockResolvedValue(
      'successor' in over ? over.successor : { id: 'doc-2', documentNumber: 'ACCO-OB-0013', status: 'ISSUED' },
    ),
    findRevisions: jest.fn().mockResolvedValue([revision()]),
    findRevision: jest
      .fn()
      .mockResolvedValue(over.revision === null ? null : revision(over.revision ?? {})),
    findRevisionStatuses: jest
      .fn()
      .mockResolvedValue(
        over.revisionStatuses ?? [{ id: 'rev-1', status: 'DRAFT', platformFileId: 'f-1' }],
      ),
    findIssuedRevision: jest.fn().mockResolvedValue({ id: 'rev-0' }),
    findByNumber: jest.fn().mockResolvedValue(over.numberClash ? { id: 'other' } : null),
    nextRevisionNumber: jest.fn().mockResolvedValue(2),
    summaryCounts: jest.fn().mockResolvedValue({
      controlledDocuments: 1,
      currentDrawings: 0,
      expiringSoon: 0,
      expired: 0,
      draft: 1,
    }),
    resolveUserNames: jest.fn().mockResolvedValue(new Map([['user-1', 'Abdulsalam S']])),
    findActivity: jest.fn().mockResolvedValue([]),
    findFileStatus: jest.fn().mockResolvedValue('file' in over ? over.file : READY_FILE),
    findProjectMember: jest.fn().mockResolvedValue(over.member === false ? null : { id: 'pm-1' }),
    createDocument: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    createRevision: jest.fn().mockResolvedValue({ id: 'rev-2' }),
    setCurrentRevision: jest.fn().mockResolvedValue(doc),
    updateDocument: jest.fn().mockResolvedValue(doc),
    updateRevision: jest.fn().mockResolvedValue(revision()),
    deleteDocument: jest.fn().mockResolvedValue(doc),
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  const files = {
    bind: jest.fn().mockResolvedValue(undefined),
    markImmutable: jest.fn().mockResolvedValue(undefined),
    discardIfUnreferenced: jest.fn().mockResolvedValue(true),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const prisma = { $transaction: (fn: (tx: unknown) => unknown) => fn({}) };
  const tenancy = { getClient: () => prisma };
  const config = { get: jest.fn().mockReturnValue(undefined) };

  const service = new ProjectDocumentService(
    tenancy as never,
    repo as never,
    projectAccess as never,
    files as never,
    audit as never,
    config as never,
  );
  return { repo, projectAccess, files, audit, service };
}

const createDto = {
  documentNumber: 'ACCO-OB-0012',
  title: 'Building permit',
  category: 'PERMIT_LICENSE' as never,
  platformFileId: 'f-1',
};

describe('ProjectDocumentService — registering a controlled document', () => {
  it('creates the document and its first revision, and binds the file', async () => {
    const { repo, projectAccess, files, service } = build();
    await service.create(identity, 'p-1', createDto);

    expect(projectAccess.assertMember).toHaveBeenCalledWith(identity, 'p-1');
    expect(repo.createDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ documentNumber: 'ACCO-OB-0012', title: 'Building permit' }),
    );
    expect(repo.createRevision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ revisionNumber: 1 }),
    );
    expect(files.bind).toHaveBeenCalledWith('f-1', expect.stringContaining('revision 1'));
  });

  it('does NOT freeze the file — uploading is not issuance', async () => {
    const { files, service } = build();
    await service.create(identity, 'p-1', createDto);
    expect(files.markImmutable).not.toHaveBeenCalled();
  });

  it('stores the number the user typed and an upper-cased key to enforce uniqueness on', async () => {
    const { repo, service } = build();
    await service.create(identity, 'p-1', { ...createDto, documentNumber: ' acco-ob-0012 ' });
    expect(repo.createDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        documentNumber: 'acco-ob-0012',
        documentNumberNormalized: 'ACCO-OB-0012',
      }),
    );
  });

  it('refuses a document number already used on the project, case-insensitively', async () => {
    const { service } = build({ numberClash: true });
    await expect(service.create(identity, 'p-1', createDto)).rejects.toThrow(BadRequestException);
  });

  it('refuses a revision purpose on anything but a drawing', async () => {
    const { service } = build();
    await expect(
      service.create(identity, 'p-1', {
        ...createDto,
        purpose: 'ISSUED_FOR_CONSTRUCTION' as never,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a revision purpose on a drawing', async () => {
    const { repo, service } = build();
    await service.create(identity, 'p-1', {
      ...createDto,
      category: 'DRAWING' as never,
      purpose: 'ISSUED_FOR_CONSTRUCTION' as never,
    });
    expect(repo.createRevision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ purpose: 'ISSUED_FOR_CONSTRUCTION' }),
    );
  });

  it('refuses a validity window that ends before it starts', async () => {
    const { service } = build();
    await expect(
      service.create(identity, 'p-1', {
        ...createDto,
        validFrom: '2026-12-01',
        expiresAt: '2026-06-01',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a responsible person who is not a member of the project', async () => {
    const { service } = build({ member: false });
    await expect(
      service.create(identity, 'p-1', { ...createDto, responsibleUserId: 'user-9' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a file that has not finished uploading', async () => {
    const { service } = build({ file: { ...READY_FILE, status: 'PENDING' } });
    await expect(service.create(identity, 'p-1', createDto)).rejects.toThrow(BadRequestException);
  });

  it('refuses a file another record already owns', async () => {
    const { service } = build({ file: { ...READY_FILE, lifecycle: 'BOUND' } });
    await expect(service.create(identity, 'p-1', createDto)).rejects.toThrow(BadRequestException);
  });

  it('refuses a file someone else uploaded', async () => {
    const { service } = build({ file: { ...READY_FILE, uploadedBy: 'user-2' } });
    await expect(service.create(identity, 'p-1', createDto)).rejects.toThrow(ForbiddenException);
  });
});

describe('ProjectDocumentService — issuing', () => {
  it('supersedes the outgoing revision, promotes this one and issues the document', async () => {
    const { repo, service } = build({ doc: { currentRevisionId: 'rev-0' } });
    await service.issueRevision(identity, 'p-1', 'doc-1', 'rev-1', {});

    expect(repo.updateRevision).toHaveBeenCalledWith(
      expect.anything(),
      'rev-0',
      expect.objectContaining({ status: 'SUPERSEDED' }),
    );
    expect(repo.updateRevision).toHaveBeenCalledWith(
      expect.anything(),
      'rev-1',
      expect.objectContaining({ status: 'ISSUED', issuedBy: 'user-1' }),
    );
    expect(repo.updateDocument).toHaveBeenCalledWith(
      expect.anything(),
      'doc-1',
      expect.objectContaining({ status: 'ISSUED' }),
    );
  });

  it('freezes the issued revision file — a correction is a new revision, never a replacement', async () => {
    const { files, service } = build();
    await service.issueRevision(identity, 'p-1', 'doc-1', 'rev-1', {});
    expect(files.markImmutable).toHaveBeenCalledWith('f-1', expect.stringContaining('issued'));
  });

  it('leaves an already-issued document ISSUED rather than re-stamping its issue date', async () => {
    const { repo, service } = build({ doc: { status: 'ISSUED', issuedAt: new Date('2026-01-01') } });
    await service.issueRevision(identity, 'p-1', 'doc-1', 'rev-1', {});
    const [, , data] = repo.updateDocument.mock.calls[0] as [unknown, string, Record<string, unknown>];
    expect(data['status']).toBeUndefined();
  });

  it('refuses to issue a revision that is not a draft', async () => {
    const { service } = build({ revision: { status: 'ISSUED' } });
    await expect(service.issueRevision(identity, 'p-1', 'doc-1', 'rev-1', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses to issue a revision whose file never finished uploading', async () => {
    const { service } = build({ revision: { platformFile: platformFile({ status: 'PENDING' }) } });
    await expect(service.issueRevision(identity, 'p-1', 'doc-1', 'rev-1', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses to issue anything on a withdrawn document', async () => {
    const { service } = build({ doc: { status: 'WITHDRAWN' } });
    await expect(service.issueRevision(identity, 'p-1', 'doc-1', 'rev-1', {})).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('ProjectDocumentService — revisions', () => {
  it('starts a new revision on an issued document and binds its file', async () => {
    const { repo, files, service } = build({
      doc: { status: 'ISSUED' },
      revisionStatuses: [{ id: 'rev-1', status: 'ISSUED', platformFileId: 'f-1' }],
    });
    await service.createRevision(identity, 'p-1', 'doc-1', { platformFileId: 'f-2' });

    expect(repo.createRevision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ revisionNumber: 2 }),
    );
    expect(files.bind).toHaveBeenCalledWith('f-2', expect.stringContaining('revision 2'));
  });

  it('refuses a second draft revision — "which one gets issued" must have one answer', async () => {
    const { service } = build({
      doc: { status: 'ISSUED' },
      revisionStatuses: [{ id: 'rev-2', status: 'DRAFT', platformFileId: 'f-1' }],
    });
    await expect(
      service.createRevision(identity, 'p-1', 'doc-1', { platformFileId: 'f-2' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('replaces a draft revision file and discards the file it replaced', async () => {
    const { repo, files, service } = build();
    await service.replaceRevisionFile(identity, 'p-1', 'doc-1', 'rev-1', {
      platformFileId: 'f-2',
    });
    expect(repo.updateRevision).toHaveBeenCalledWith(expect.anything(), 'rev-1', {
      platformFile: { connect: { id: 'f-2' } },
    });
    expect(files.bind).toHaveBeenCalledWith('f-2', expect.any(String));
    expect(files.discardIfUnreferenced).toHaveBeenCalledWith('f-1');
  });

  it('refuses to replace the file behind an issued revision', async () => {
    const { service } = build({ revision: { status: 'ISSUED' } });
    await expect(
      service.replaceRevisionFile(identity, 'p-1', 'doc-1', 'rev-1', { platformFileId: 'f-2' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('reports a revision on another document as not found', async () => {
    const { service } = build({ revision: null });
    await expect(
      service.replaceRevisionFile(identity, 'p-1', 'doc-1', 'rev-9', { platformFileId: 'f-2' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ProjectDocumentService — metadata', () => {
  it('lets a draft change everything, including its number and category', async () => {
    const { repo, service } = build();
    await service.update(identity, 'p-1', 'doc-1', {
      documentNumber: 'ACCO-OB-0099',
      category: 'DRAWING' as never,
    });
    expect(repo.updateDocument).toHaveBeenCalledWith(
      expect.anything(),
      'doc-1',
      expect.objectContaining({ documentNumber: 'ACCO-OB-0099', category: 'DRAWING' }),
    );
  });

  it('refuses to renumber an issued document — the number is how it is cited', async () => {
    const { service } = build({ doc: { status: 'ISSUED' } });
    await expect(
      service.update(identity, 'p-1', 'doc-1', { documentNumber: 'ACCO-OB-0099' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows an issued document to change expiry — that is a fact about the world', async () => {
    const { repo, service } = build({ doc: { status: 'ISSUED' } });
    await service.update(identity, 'p-1', 'doc-1', { expiresAt: '2027-01-01' });
    expect(repo.updateDocument).toHaveBeenCalledWith(
      expect.anything(),
      'doc-1',
      expect.objectContaining({ expiresAt: new Date('2027-01-01T00:00:00.000Z') }),
    );
  });

  it('distinguishes clearing a date from leaving it alone', async () => {
    const { repo, service } = build({ doc: { status: 'ISSUED' } });
    await service.update(identity, 'p-1', 'doc-1', { expiresAt: null });
    expect(repo.updateDocument).toHaveBeenCalledWith(
      expect.anything(),
      'doc-1',
      expect.objectContaining({ expiresAt: null }),
    );
  });

  it('refuses any edit to a superseded document', async () => {
    const { service } = build({ doc: { status: 'SUPERSEDED' } });
    await expect(service.update(identity, 'p-1', 'doc-1', { title: 'x' })).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('ProjectDocumentService — lifecycle and deletion', () => {
  it('withdraws an issued document and its current revision together', async () => {
    const { repo, service } = build({ doc: { status: 'ISSUED' } });
    await service.withdraw(identity, 'p-1', 'doc-1', { reason: 'Superseded by the consultant' });
    expect(repo.updateDocument).toHaveBeenCalledWith(
      expect.anything(),
      'doc-1',
      expect.objectContaining({ status: 'WITHDRAWN' }),
    );
    expect(repo.updateRevision).toHaveBeenCalledWith(
      expect.anything(),
      'rev-1',
      expect.objectContaining({ status: 'WITHDRAWN' }),
    );
  });

  it('refuses to withdraw a document that was never issued', async () => {
    const { service } = build();
    await expect(
      service.withdraw(identity, 'p-1', 'doc-1', { reason: 'x' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('supersedes one document with another issued one, and records the link', async () => {
    const { repo, service } = build({ doc: { status: 'ISSUED' } });
    await service.supersede(identity, 'p-1', 'doc-1', { supersededByDocumentId: 'doc-2' });
    expect(repo.updateDocument).toHaveBeenCalledWith(
      expect.anything(),
      'doc-1',
      expect.objectContaining({
        status: 'SUPERSEDED',
        supersededBy: { connect: { id: 'doc-2' } },
      }),
    );
  });

  it('refuses to be superseded by a document that is not itself issued', async () => {
    const { service } = build({
      doc: { status: 'ISSUED' },
      successor: { id: 'doc-2', documentNumber: 'X', status: 'DRAFT' },
    });
    await expect(
      service.supersede(identity, 'p-1', 'doc-1', { supersededByDocumentId: 'doc-2' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses to supersede a document with itself', async () => {
    const { service } = build({ doc: { status: 'ISSUED' } });
    await expect(
      service.supersede(identity, 'p-1', 'doc-1', { supersededByDocumentId: 'doc-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('deletes a draft that was never issued, and discards its files', async () => {
    const { repo, files, service } = build();
    await service.remove(identity, 'p-1', 'doc-1');
    expect(repo.setCurrentRevision).toHaveBeenCalledWith(expect.anything(), 'doc-1', null);
    expect(repo.deleteDocument).toHaveBeenCalled();
    expect(files.discardIfUnreferenced).toHaveBeenCalledWith('f-1');
  });

  it('refuses to delete an issued document', async () => {
    const { service } = build({ doc: { status: 'ISSUED' } });
    await expect(service.remove(identity, 'p-1', 'doc-1')).rejects.toThrow(ForbiddenException);
  });

  it('refuses to delete a draft that has an issued revision in its history', async () => {
    const { service } = build({
      revisionStatuses: [
        { id: 'rev-1', status: 'SUPERSEDED', platformFileId: 'f-1' },
        { id: 'rev-2', status: 'DRAFT', platformFileId: 'f-2' },
      ],
    });
    await expect(service.remove(identity, 'p-1', 'doc-1')).rejects.toThrow(ForbiddenException);
  });
});

describe('ProjectDocumentService — reads', () => {
  it('reports the expiring-soon threshold so the screen can say why something is flagged', async () => {
    const { service } = build();
    const result = await service.list(identity, 'p-1', {});
    expect(result.summary.expiringSoonDays).toBe(30);
  });

  it('derives validity rather than reading a stored state', async () => {
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const { service } = build({ doc: { expiresAt: past } });
    const result = await service.list(identity, 'p-1', {});
    expect(result.items[0]?.validity).toBe('EXPIRED');
    expect(result.items[0]?.daysUntilExpiry).toBeLessThan(0);
  });

  it('separates issuing from drafting in the capability flags', () => {
    const { service } = build();
    const drafter = service.capabilities({
      ...identity,
      permissions: [PERMISSIONS.projectDocumentsManage],
    });
    expect(drafter.canCreate).toBe(true);
    expect(drafter.canIssue).toBe(false);

    const issuer = service.capabilities({
      ...identity,
      permissions: [PERMISSIONS.projectDocumentsIssue],
    });
    expect(issuer.canCreate).toBe(false);
    expect(issuer.canIssue).toBe(true);
  });
});
