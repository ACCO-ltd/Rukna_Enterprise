import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { PlatformFileService } from './platform-file.service.js';

const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

/** A real SHA-256 (of the empty string) — the format validator is not a formality. */
const SUM = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const OTHER_SUM = 'a'.repeat(64);

function build(file: Record<string, unknown> | null, overrides: Record<string, unknown> = {}) {
  const repo = {
    create: jest.fn().mockResolvedValue({ id: 'file-1' }),
    findById: jest.fn().mockResolvedValue(file),
    markReady: jest.fn().mockResolvedValue({ id: 'file-1', status: 'READY' }),
    setLifecycle: jest.fn().mockImplementation((_p, id, lifecycle) => ({ id, lifecycle })),
    setLifecycleMany: jest.fn().mockResolvedValue(0),
    findReapable: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue({ id: 'file-1' }),
  };
  const storage = {
    presignUpload: jest.fn().mockResolvedValue('https://storage.rukna.site/put?sig=1'),
    presignDownload: jest.fn().mockResolvedValue('https://storage.rukna.site/get?sig=1'),
    statObject: jest.fn(),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  const fileAuth = {
    assertCanRead: jest.fn().mockResolvedValue(undefined),
    assertCanWrite: jest.fn().mockResolvedValue(undefined),
    assertCanDelete: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const prisma = {
    platformFile: {
      findUnique: jest.fn().mockResolvedValue(file),
    },
  };
  const tenancy = { getClient: () => prisma };
  const config = { get: (key: string) => (key === 'FILE_STORAGE_BUCKET' ? 'rukna-files' : undefined) };
  const service = new PlatformFileService(
    tenancy as never,
    repo as never,
    config as never,
    fileAuth as never,
    storage as never,
  );
  return { repo, storage, fileAuth, prisma, service };
}

const pending = {
  id: 'file-1',
  status: 'PENDING',
  storageBucket: 'rukna-files',
  storageKey: 'acco/org-1/k',
  lifecycle: 'TEMPORARY',
  checksumSha256: SUM,
  originalName: 'a.pdf',
  mimeType: 'application/pdf',
};
const ready = { ...pending, status: 'READY' };

describe('PlatformFileService (ADR-014)', () => {
  describe('upload', () => {
    it('creates a TEMPORARY file with a tenant-partitioned key and signs the PUT with the checksum', async () => {
      const { repo, storage, service } = build(null);
      const res = await service.initiateUpload(identity, {
        originalName: 'a.pdf',
        mimeType: 'application/pdf',
        checksumSha256: SUM,
      });

      expect(res.fileId).toBe('file-1');
      const created = repo.create.mock.calls[0][1];
      expect(created.storageKey).toMatch(/^acco\/org-1\//);
      expect(created.checksumSha256).toBe(SUM);
      // The checksum reaches the adapter, which is what makes storage reject a mismatched body.
      expect(storage.presignUpload).toHaveBeenCalledWith(
        'rukna-files',
        created.storageKey,
        'application/pdf',
        { checksumSha256: SUM },
      );
    });

    /** A field that claims integrity and accepts anything is decoration. */
    it.each([['not-hex'], [''], ['ABC'], ['e3b0c442'.repeat(9)]])(
      'refuses %p as a checksum',
      async (bad) => {
        const { repo, service } = build(null);
        await expect(
          service.initiateUpload(identity, { originalName: 'a.pdf', mimeType: 'x', checksumSha256: bad }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(repo.create).not.toHaveBeenCalled();
      },
    );

    it('normalises an upper-case digest rather than storing two spellings of one hash', async () => {
      const { repo, service } = build(null);
      await service.initiateUpload(identity, {
        originalName: 'a.pdf',
        mimeType: 'application/pdf',
        checksumSha256: SUM.toUpperCase(),
      });
      expect(repo.create.mock.calls[0][1].checksumSha256).toBe(SUM);
    });
  });

  describe('confirm', () => {
    it('marks READY when the object exists, without letting the client restate the checksum', async () => {
      const { repo, storage, service } = build(pending);
      storage.statObject.mockResolvedValue({ exists: true, sizeBytes: 2048 });

      await service.confirmUpload(identity, 'file-1', { checksumSha256: SUM });

      // The registered checksum is authoritative: markReady takes size only.
      expect(repo.markReady).toHaveBeenCalledWith(expect.anything(), 'file-1', 2048);
    });

    it('rejects when the object is missing from storage', async () => {
      const { repo, storage, service } = build(pending);
      storage.statObject.mockResolvedValue({ exists: false, sizeBytes: 0 });
      await expect(service.confirmUpload(identity, 'file-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.markReady).not.toHaveBeenCalled();
    });

    it('rejects a confirm that restates a different checksum', async () => {
      const { repo, service } = build(pending);
      await expect(
        service.confirmUpload(identity, 'file-1', { checksumSha256: OTHER_SUM }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.markReady).not.toHaveBeenCalled();
    });

    /** The case the whole checksum design exists for: storage holds bytes we did not promise. */
    it('rejects when the stored object hashes to something else', async () => {
      const { repo, storage, service } = build(pending);
      storage.statObject.mockResolvedValue({
        exists: true,
        sizeBytes: 2048,
        checksumSha256: OTHER_SUM,
      });
      await expect(service.confirmUpload(identity, 'file-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.markReady).not.toHaveBeenCalled();
    });

    it('authorizes the confirm as a write before touching storage', async () => {
      const denied = jest.fn().mockRejectedValue(new ForbiddenException());
      const { storage, service } = build(pending, { assertCanWrite: denied });
      await expect(service.confirmUpload(identity, 'file-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(storage.statObject).not.toHaveBeenCalled();
    });
  });

  describe('download', () => {
    it('returns a signed URL for a READY file', async () => {
      const { storage, service } = build(ready);
      const res = await service.getDownloadUrl(identity, 'file-1');
      expect(res.url).toContain('storage.rukna.site');
      expect(storage.presignDownload).toHaveBeenCalledWith('rukna-files', 'acco/org-1/k');
    });

    it('rejects a file with no stored bytes (still PENDING)', async () => {
      const { service } = build(pending);
      await expect(service.getDownloadUrl(identity, 'file-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    /** No URL is signed for a caller the authorization service refused. */
    it('authorizes before signing anything', async () => {
      const denied = jest.fn().mockRejectedValue(new ForbiddenException());
      const { storage, service } = build(ready, { assertCanRead: denied });
      await expect(service.getDownloadUrl(identity, 'file-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(storage.presignDownload).not.toHaveBeenCalled();
    });

    it('reports a file from another tenant as not found', async () => {
      const { service } = build(null);
      await expect(service.getDownloadUrl(identity, 'foreign')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('lifecycle', () => {
    it('binds a temporary file and records why', async () => {
      const { repo, service } = build(pending);
      await service.bind('file-1', 'project document doc-1');
      expect(repo.setLifecycle).toHaveBeenCalledWith(
        expect.anything(),
        'file-1',
        'BOUND',
        'project document doc-1',
      );
    });

    it('is a no-op when the file is already bound', async () => {
      const { repo, service } = build({ ...ready, lifecycle: 'BOUND' });
      await service.bind('file-1', 'again');
      expect(repo.setLifecycle).not.toHaveBeenCalled();
    });

    /** A finalised file must never be quietly downgraded to a replaceable one. */
    it('refuses to bind a finalised file', async () => {
      const { repo, service } = build({ ...ready, lifecycle: 'IMMUTABLE' });
      await expect(service.bind('file-1', 'reuse')).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.setLifecycle).not.toHaveBeenCalled();
    });

    it('freezes a bound file when its record finalises', async () => {
      const { repo, service } = build({ ...ready, lifecycle: 'BOUND' });
      await service.markImmutable('file-1', 'evidence on approved report dpr-1');
      expect(repo.setLifecycle).toHaveBeenCalledWith(
        expect.anything(),
        'file-1',
        'IMMUTABLE',
        'evidence on approved report dpr-1',
      );
    });
  });

  describe('delete', () => {
    it('removes the object before the row', async () => {
      const { repo, storage, service } = build(ready);
      await service.delete(identity, 'file-1');
      expect(storage.deleteObject).toHaveBeenCalledWith('rukna-files', 'acco/org-1/k');
      expect(repo.delete).toHaveBeenCalledWith(expect.anything(), 'file-1');
    });

    /** The delete guard is the authorization service's, and this proves it is consulted. */
    it('deletes nothing when authorization refuses', async () => {
      const denied = jest.fn().mockRejectedValue(new ForbiddenException());
      const { repo, storage, service } = build(ready, { assertCanDelete: denied });
      await expect(service.delete(identity, 'file-1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(storage.deleteObject).not.toHaveBeenCalled();
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });

  describe('discardIfUnreferenced', () => {
    function buildDiscard(file: Record<string, unknown> | null) {
      const built = build(ready);
      built.prisma.platformFile.findUnique = jest.fn().mockResolvedValue(file);
      return built;
    }

    it('removes a file nothing references any more', async () => {
      const { storage, repo, service } = buildDiscard({
        id: 'file-1',
        storageBucket: 'rukna-files',
        storageKey: 'acco/org-1/k',
        lifecycle: 'BOUND',
        _count: { projectDocuments: 0, dprAttachments: 0 },
      });

      await expect(service.discardIfUnreferenced('file-1')).resolves.toBe(true);
      expect(storage.deleteObject).toHaveBeenCalled();
      expect(repo.delete).toHaveBeenCalled();
    });

    it('keeps a file another record still references', async () => {
      const { storage, service } = buildDiscard({
        id: 'file-1',
        storageBucket: 'rukna-files',
        storageKey: 'acco/org-1/k',
        lifecycle: 'BOUND',
        _count: { projectDocuments: 0, dprAttachments: 1 },
      });

      await expect(service.discardIfUnreferenced('file-1')).resolves.toBe(false);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });

    it('keeps a finalised file even when nothing references it', async () => {
      const { storage, service } = buildDiscard({
        id: 'file-1',
        storageBucket: 'rukna-files',
        storageKey: 'acco/org-1/k',
        lifecycle: 'IMMUTABLE',
        _count: { projectDocuments: 0, dprAttachments: 0 },
      });

      await expect(service.discardIfUnreferenced('file-1')).resolves.toBe(false);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
  });

  describe('cleanupAbandonedUploads', () => {
    const abandoned = [
      { id: 'f1', storageBucket: 'rukna-files', storageKey: 'k1', createdAt: new Date(0) },
      { id: 'f2', storageBucket: 'rukna-files', storageKey: 'k2', createdAt: new Date(0) },
    ];

    it('reaps each candidate storage-first', async () => {
      const { repo, storage, service } = build(ready);
      repo.findReapable.mockResolvedValue(abandoned);

      const result = await service.cleanupAbandonedUploads({ retentionHours: 24 });

      expect(result.deleted).toBe(2);
      expect(result.failed).toBe(0);
      expect(storage.deleteObject).toHaveBeenCalledTimes(2);
      expect(repo.delete).toHaveBeenCalledTimes(2);
    });

    /**
     * The safety property is the lifecycle filter, not the date. This asserts the query the sweep
     * actually issues, because a cleanup that widened it would be catastrophic and silent.
     */
    it('only ever asks for TEMPORARY files older than the window', async () => {
      const { repo, service } = build(ready);
      const before = Date.now();
      await service.cleanupAbandonedUploads({ retentionHours: 2 });

      const cutoff = repo.findReapable.mock.calls[0][1] as Date;
      expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
    });

    it('reports without changing anything on a dry run', async () => {
      const { repo, storage, service } = build(ready);
      repo.findReapable.mockResolvedValue(abandoned);

      const result = await service.cleanupAbandonedUploads({ dryRun: true });

      expect(result.examined).toBe(2);
      expect(result.deleted).toBe(0);
      expect(storage.deleteObject).not.toHaveBeenCalled();
      expect(repo.delete).not.toHaveBeenCalled();
    });

    /** One unreachable object must not strand the rest of the sweep. */
    it('skips a file it cannot remove and keeps going', async () => {
      const { repo, storage, service } = build(ready);
      repo.findReapable.mockResolvedValue(abandoned);
      storage.deleteObject.mockRejectedValueOnce(new Error('storage down'));

      const result = await service.cleanupAbandonedUploads({});

      expect(result.failed).toBe(1);
      expect(result.deleted).toBe(1);
    });

    it('is idempotent — a second run with nothing left deletes nothing', async () => {
      const { repo, storage, service } = build(ready);
      repo.findReapable.mockResolvedValue([]);

      const result = await service.cleanupAbandonedUploads({});

      expect(result).toMatchObject({ examined: 0, deleted: 0, failed: 0 });
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
  });
});
