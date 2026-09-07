import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import { PlatformFileRepository } from '../infrastructure/platform-file.repository.js';
import { FileAuthorizationService } from './file-authorization.service.js';
import { FILE_STORAGE_PORT, type IFileStoragePort } from './ports/file-storage.port.js';

export interface InitiateUploadDto {
  originalName: string;
  mimeType: string;
  /** Lower-case hex SHA-256 of the bytes, computed by the client before the upload. */
  checksumSha256: string;
}

export interface ConfirmUploadDto {
  /** Optional re-statement of the checksum; must match what was registered at presign. */
  checksumSha256?: string;
}

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const DEFAULT_TEMPORARY_RETENTION_HOURS = 24;

/**
 * ADR-014 `PlatformFile` lifecycle: metadata, the two-step upload, authorization-gated download
 * URLs, and the ownership lifecycle that decides what may be deleted.
 *
 * Three things changed here in Phase 7 Step 2, all of them defects the audit found:
 *
 * 1. **Every operation authorizes through {@link FileAuthorizationService}.** Nothing in this
 *    service decides access on its own; a file inherits its permissions from the record that owns
 *    it.
 * 2. **`immutable` became a three-state lifecycle.** The boolean was never set by anything, so the
 *    delete guard it fed never fired. TEMPORARY / BOUND / IMMUTABLE, with `bind()` and
 *    `markImmutable()` called by the modules that actually own the transitions.
 * 3. **The checksum is real.** It is supplied by the client *before* the upload and used to sign
 *    the PUT, so object storage rejects a body that does not hash to it. Previously the column was
 *    null on every row ever written: the client sent nothing and the adapter returned nothing.
 */
@Injectable()
export class PlatformFileService {
  private readonly logger = new Logger(PlatformFileService.name);

  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: PlatformFileRepository,
    private readonly config: ConfigService,
    private readonly fileAuth: FileAuthorizationService,
    @Inject(FILE_STORAGE_PORT) private readonly storage: IFileStoragePort,
  ) {}

  private get bucket(): string {
    return this.config.get<string>('FILE_STORAGE_BUCKET') ?? 'rukna-files';
  }

  /**
   * Create a TEMPORARY file and return a presigned URL for the client to upload the bytes.
   *
   * The checksum is required here rather than at confirm, because it is what makes the integrity
   * claim enforceable: the PUT is signed with it, so storage refuses bytes that do not match.
   * Taking it afterwards would only record whatever the client chose to say.
   */
  async initiateUpload(identity: RequestIdentity, dto: InitiateUploadDto) {
    const checksum = normaliseChecksum(dto.checksumSha256);

    const prisma = this.tenancy.getClient();
    // Tenant-partitioned key prefix (ADR-014). Independent of the row id so we can key before insert.
    const storageKey = `${identity.tenantSlug}/${identity.activeOrganizationId}/${randomUUID()}`;

    const file = await this.repo.create(prisma, {
      organizationId: identity.activeOrganizationId,
      originalName: dto.originalName,
      mimeType: dto.mimeType,
      checksumSha256: checksum,
      storageBucket: this.bucket,
      storageKey,
      uploadedBy: identity.userId,
    });

    const uploadUrl = await this.storage.presignUpload(this.bucket, storageKey, dto.mimeType, {
      checksumSha256: checksum,
    });
    return { fileId: file.id, uploadUrl, checksumSha256: checksum };
  }

  /**
   * After the client uploads, verify the object landed and mark the file READY.
   *
   * Whatever integrity the store can report is checked here too. When storage returns its own
   * SHA-256 (it does when the PUT was signed with one) a mismatch is a hard failure — the file
   * stays PENDING and the caller is told, rather than a corrupt object being marked ready.
   */
  async confirmUpload(identity: RequestIdentity, fileId: string, dto: ConfirmUploadDto = {}) {
    await this.fileAuth.assertCanWrite(identity, fileId);

    const prisma = this.tenancy.getClient();
    const file = await this.repo.findById(prisma, identity.activeOrganizationId, fileId);
    if (!file) throw new NotFoundException(`File ${fileId} not found`);
    if (file.status === 'READY') return file;

    if (dto.checksumSha256 !== undefined) {
      const restated = normaliseChecksum(dto.checksumSha256);
      if (file.checksumSha256 && restated !== file.checksumSha256) {
        throw new BadRequestException(
          'The checksum does not match the one registered when the upload was requested.',
        );
      }
    }

    const stat = await this.storage.statObject(file.storageBucket, file.storageKey);
    if (!stat.exists) {
      throw new BadRequestException('Upload not found in storage — the file was not received.');
    }
    if (stat.checksumSha256 && file.checksumSha256 && stat.checksumSha256 !== file.checksumSha256) {
      throw new BadRequestException(
        'The stored object does not match the checksum registered for this upload.',
      );
    }

    return this.repo.markReady(prisma, fileId, stat.sizeBytes);
  }

  /** Authorization-gated, short-lived signed URL to download the bytes (ADR-014). */
  async getDownloadUrl(identity: RequestIdentity, fileId: string) {
    await this.fileAuth.assertCanRead(identity, fileId);

    const prisma = this.tenancy.getClient();
    const file = await this.repo.findById(prisma, identity.activeOrganizationId, fileId);
    if (!file) throw new NotFoundException(`File ${fileId} not found`);
    if (file.status !== 'READY') {
      throw new BadRequestException('File has no stored bytes yet.');
    }
    const url = await this.storage.presignDownload(file.storageBucket, file.storageKey);
    return { url, originalName: file.originalName, mimeType: file.mimeType };
  }

  /**
   * TEMPORARY → BOUND. Called by the module that just attached the file to one of its records.
   *
   * Returns the file so the caller can assert on it in the same transaction. Idempotent: binding
   * an already-BOUND file is a no-op, and binding an IMMUTABLE one is refused rather than silently
   * downgrading it.
   */
  async bind(fileId: string, reason: string) {
    const prisma = this.tenancy.getClient();
    const file = await prisma.platformFile.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException(`File ${fileId} not found`);
    if (file.lifecycle === 'BOUND') return file;
    if (file.lifecycle === 'IMMUTABLE') {
      throw new BadRequestException('This file is already part of a finalised record.');
    }
    return this.repo.setLifecycle(prisma, fileId, 'BOUND', reason);
  }

  /**
   * BOUND → IMMUTABLE. Called when the owning record finalises — approved, posted, issued,
   * baselined. From here a correction appends a new file; it never replaces this one.
   *
   * Not called on every bind, deliberately: a file on a draft record is still legitimately
   * replaceable, and freezing it there would make the draft workflow lie.
   */
  async markImmutable(fileId: string, reason: string) {
    const prisma = this.tenancy.getClient();
    const file = await prisma.platformFile.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException(`File ${fileId} not found`);
    if (file.lifecycle === 'IMMUTABLE') return file;
    return this.repo.setLifecycle(prisma, fileId, 'IMMUTABLE', reason);
  }

  /** Freeze every file attached to a record that has just finalised. */
  async markManyImmutable(fileIds: string[], reason: string): Promise<number> {
    if (fileIds.length === 0) return 0;
    return this.repo.setLifecycleMany(this.tenancy.getClient(), fileIds, 'IMMUTABLE', reason);
  }

  /**
   * Delete an abandoned upload.
   *
   * Only ever reaches a TEMPORARY file — {@link FileAuthorizationService.assertCanDelete} refuses
   * a bound or finalised one, because those are deleted through the record that owns them, if at
   * all. The object goes first: a row without bytes is a reapable inconsistency, bytes without a
   * row are invisible and permanent.
   */
  async delete(identity: RequestIdentity, fileId: string) {
    await this.fileAuth.assertCanDelete(identity, fileId);

    const prisma = this.tenancy.getClient();
    const file = await this.repo.findById(prisma, identity.activeOrganizationId, fileId);
    if (!file) throw new NotFoundException(`File ${fileId} not found`);

    await this.storage.deleteObject(file.storageBucket, file.storageKey);
    return this.repo.delete(prisma, fileId);
  }

  /**
   * Discard a file that a module has just detached from its last owner.
   *
   * The register's delete used to remove only its own row, leaving the file and the bytes behind
   * for good (audit P1-2). This is the other half of that operation, called by the owning module
   * once it knows nothing else references the file. It re-reads the bindings itself rather than
   * trusting the caller.
   */
  async discardIfUnreferenced(fileId: string): Promise<boolean> {
    const prisma = this.tenancy.getClient();
    const file = await prisma.platformFile.findUnique({
      where: { id: fileId },
      select: {
        id: true,
        storageBucket: true,
        storageKey: true,
        lifecycle: true,
        // EVERY binding kind, not just the caller's. A file this module was told to discard may
        // still be owned by something else, and a count that knows about only two of six owners
        // is a delete waiting to destroy a contract attachment.
        _count: {
          select: {
            documentRevisions: true,
            dprAttachments: true,
            contractAttachments: true,
            guaranteeAttachments: true,
            ipaAttachments: true,
            ipcAttachments: true,
            journalEntryAttachments: true,
          },
        },
      },
    });
    if (!file) return false;
    if (file.lifecycle === 'IMMUTABLE') return false;
    if (Object.values(file._count).some((count) => count > 0)) return false;

    await this.storage.deleteObject(file.storageBucket, file.storageKey);
    await this.repo.delete(prisma, file.id);
    return true;
  }

  /**
   * Reap abandoned uploads.
   *
   * A file becomes reapable by being TEMPORARY for longer than the retention window: nothing ever
   * bound it, so no business record can be harmed by its removal. BOUND and IMMUTABLE files are
   * never considered — the filter is on lifecycle, not on age, so a long-lived attachment is not
   * one slow query away from deletion.
   *
   * Idempotent and restartable: each file is removed independently, storage-first, and a failure
   * on one is logged and skipped rather than aborting the sweep. Re-running finishes the job.
   */
  async cleanupAbandonedUploads(options: { retentionHours?: number; dryRun?: boolean } = {}) {
    const retentionHours =
      options.retentionHours ??
      Number(this.config.get<string>('FILE_TEMPORARY_RETENTION_HOURS')) ??
      DEFAULT_TEMPORARY_RETENTION_HOURS;
    const hours = Number.isFinite(retentionHours) && retentionHours > 0
      ? retentionHours
      : DEFAULT_TEMPORARY_RETENTION_HOURS;

    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const prisma = this.tenancy.getClient();
    const candidates = await this.repo.findReapable(prisma, cutoff);

    const result = {
      retentionHours: hours,
      cutoff: cutoff.toISOString(),
      examined: candidates.length,
      deleted: 0,
      failed: 0,
      dryRun: Boolean(options.dryRun),
    };
    if (options.dryRun) return result;

    for (const file of candidates) {
      try {
        await this.storage.deleteObject(file.storageBucket, file.storageKey);
        await this.repo.delete(prisma, file.id);
        result.deleted += 1;
      } catch (err) {
        result.failed += 1;
        this.logger.warn(`Could not reap abandoned file ${file.id}: ${(err as Error).message}`);
      }
    }
    return result;
  }
}

/**
 * A checksum that is stored but never validated is decoration. Lower-case hex, 64 characters, or
 * the request does not proceed.
 */
function normaliseChecksum(value: string): string {
  const checksum = (value ?? '').trim().toLowerCase();
  if (!HEX_SHA256.test(checksum)) {
    throw new BadRequestException(
      'checksumSha256 must be a SHA-256 digest as 64 lower-case hexadecimal characters.',
    );
  }
  return checksum;
}
