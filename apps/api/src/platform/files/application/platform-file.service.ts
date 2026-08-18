import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import { PlatformFileRepository } from '../infrastructure/platform-file.repository.js';
import { FILE_STORAGE_PORT, type IFileStoragePort } from './ports/file-storage.port.js';

export interface InitiateUploadDto {
  originalName: string;
  mimeType: string;
}

export interface ConfirmUploadDto {
  /** Client-computed SHA-256; stored as the integrity record. */
  checksumSha256?: string;
}

/**
 * ADR-014: PlatformFile lifecycle. Bytes live in object storage behind {@link IFileStoragePort};
 * this service owns the metadata, the two-step upload (presign -> confirm), authorization-gated
 * download URLs, and the immutability rule (audit-relevant files cannot be deleted).
 */
@Injectable()
export class PlatformFileService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: PlatformFileRepository,
    private readonly config: ConfigService,
    @Inject(FILE_STORAGE_PORT) private readonly storage: IFileStoragePort,
  ) {}

  private get bucket(): string {
    return this.config.get<string>('FILE_STORAGE_BUCKET') ?? 'rukna-files';
  }

  /** Create a PENDING PlatformFile and return a presigned URL for the client to upload the bytes. */
  async initiateUpload(identity: RequestIdentity, dto: InitiateUploadDto) {
    const prisma = this.tenancy.getClient();
    // Tenant-partitioned key prefix (ADR-014). Independent of the row id so we can key before insert.
    const storageKey = `${identity.tenantSlug}/${identity.activeOrganizationId}/${randomUUID()}`;

    const file = await this.repo.create(prisma, {
      organizationId: identity.activeOrganizationId,
      originalName: dto.originalName,
      mimeType: dto.mimeType,
      storageBucket: this.bucket,
      storageKey,
      uploadedBy: identity.userId,
    });

    const uploadUrl = await this.storage.presignUpload(this.bucket, storageKey, dto.mimeType);
    return { fileId: file.id, uploadUrl };
  }

  /** After the client uploads, verify the object exists and mark the file READY. */
  async confirmUpload(identity: RequestIdentity, fileId: string, dto: ConfirmUploadDto = {}) {
    const prisma = this.tenancy.getClient();
    const file = await this.repo.findById(prisma, identity.activeOrganizationId, fileId);
    if (!file) throw new NotFoundException(`File ${fileId} not found`);
    if (file.status === 'READY') return file;

    const stat = await this.storage.statObject(file.storageBucket, file.storageKey);
    if (!stat.exists) {
      throw new BadRequestException('Upload not found in storage — the file was not received.');
    }
    const checksum = dto.checksumSha256 ?? stat.checksumSha256 ?? null;
    return this.repo.markReady(prisma, fileId, stat.sizeBytes, checksum);
  }

  /** Authorization-gated, short-lived signed URL to download the bytes (ADR-014). */
  async getDownloadUrl(identity: RequestIdentity, fileId: string) {
    const prisma = this.tenancy.getClient();
    const file = await this.repo.findById(prisma, identity.activeOrganizationId, fileId);
    if (!file) throw new NotFoundException(`File ${fileId} not found`);
    if (file.status !== 'READY') {
      throw new BadRequestException('File has no stored bytes yet.');
    }
    const url = await this.storage.presignDownload(file.storageBucket, file.storageKey);
    return { url, originalName: file.originalName, mimeType: file.mimeType };
  }

  /** Mark a file immutable — called by an attaching module when the file becomes audit-relevant. */
  async markImmutable(identity: RequestIdentity, fileId: string) {
    const prisma = this.tenancy.getClient();
    const file = await this.repo.findById(prisma, identity.activeOrganizationId, fileId);
    if (!file) throw new NotFoundException(`File ${fileId} not found`);
    return this.repo.setImmutable(prisma, fileId);
  }

  /**
   * Delete a file. Rejected when immutable (ADR-014). The DB FK (ON DELETE RESTRICT) is the backstop
   * against deleting a file still referenced by any attachment.
   */
  async delete(identity: RequestIdentity, fileId: string) {
    const prisma = this.tenancy.getClient();
    const file = await this.repo.findById(prisma, identity.activeOrganizationId, fileId);
    if (!file) throw new NotFoundException(`File ${fileId} not found`);
    if (file.immutable) {
      throw new BadRequestException('This file is immutable (audit-relevant) and cannot be deleted.');
    }
    return this.repo.delete(prisma, fileId);
  }
}
