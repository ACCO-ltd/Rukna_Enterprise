import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { PlatformFileService } from './platform-file.service.js';

const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

function build(file: Record<string, unknown> | null) {
  const repo = {
    create: jest.fn().mockResolvedValue({ id: 'file-1' }),
    findById: jest.fn().mockResolvedValue(file),
    markReady: jest.fn().mockResolvedValue({ id: 'file-1', status: 'READY' }),
    setImmutable: jest.fn().mockResolvedValue({ id: 'file-1', immutable: true }),
    delete: jest.fn().mockResolvedValue({ id: 'file-1' }),
  };
  const storage = {
    presignUpload: jest.fn().mockResolvedValue('https://minio/put?sig=1'),
    presignDownload: jest.fn().mockResolvedValue('https://minio/get?sig=1'),
    statObject: jest.fn(),
  };
  const tenancy = { getClient: () => ({}) };
  const config = { get: () => 'rukna-files' };
  const service = new PlatformFileService(
    tenancy as never,
    repo as never,
    config as never,
    storage as never,
  );
  return { repo, storage, service };
}

const pending = { id: 'file-1', status: 'PENDING', storageBucket: 'rukna-files', storageKey: 'acco/org-1/k', immutable: false, originalName: 'a.pdf', mimeType: 'application/pdf' };
const ready = { ...pending, status: 'READY' };

describe('PlatformFileService (ADR-014)', () => {
  it('initiateUpload: creates a PENDING file with a tenant-partitioned key + returns a presigned URL', async () => {
    const { repo, storage, service } = build(null);
    const res = await service.initiateUpload(identity, { originalName: 'a.pdf', mimeType: 'application/pdf' });
    expect(res.fileId).toBe('file-1');
    expect(res.uploadUrl).toContain('minio');
    const created = repo.create.mock.calls[0][1];
    expect(created.storageKey).toMatch(/^acco\/org-1\//);
    expect(storage.presignUpload).toHaveBeenCalledWith('rukna-files', created.storageKey, 'application/pdf');
  });

  it('confirmUpload: marks READY when the object exists in storage', async () => {
    const { repo, storage, service } = build(pending);
    storage.statObject.mockResolvedValue({ exists: true, sizeBytes: 2048, checksumSha256: 'abc' });
    await service.confirmUpload(identity, 'file-1', { checksumSha256: 'client-sum' });
    expect(repo.markReady).toHaveBeenCalledWith(expect.anything(), 'file-1', 2048, 'client-sum');
  });

  it('confirmUpload: rejects when the object is missing from storage', async () => {
    const { repo, storage, service } = build(pending);
    storage.statObject.mockResolvedValue({ exists: false, sizeBytes: 0 });
    await expect(service.confirmUpload(identity, 'file-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.markReady).not.toHaveBeenCalled();
  });

  it('getDownloadUrl: returns a signed URL for a READY file', async () => {
    const { storage, service } = build(ready);
    const res = await service.getDownloadUrl(identity, 'file-1');
    expect(res.url).toContain('minio');
    expect(storage.presignDownload).toHaveBeenCalledWith('rukna-files', 'acco/org-1/k');
  });

  it('getDownloadUrl: rejects a file with no stored bytes (still PENDING)', async () => {
    const { service } = build(pending);
    await expect(service.getDownloadUrl(identity, 'file-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('delete: rejects an immutable (audit-relevant) file', async () => {
    const { repo, service } = build({ ...ready, immutable: true });
    await expect(service.delete(identity, 'file-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('delete: removes a non-immutable file', async () => {
    const { repo, service } = build(ready);
    await service.delete(identity, 'file-1');
    expect(repo.delete).toHaveBeenCalledWith(expect.anything(), 'file-1');
  });

  it('rejects operations on a file from another tenant (findById miss)', async () => {
    const { service } = build(null);
    await expect(service.getDownloadUrl(identity, 'foreign')).rejects.toBeInstanceOf(NotFoundException);
  });
});
