import { Injectable } from '@nestjs/common';
import type { IpcAttachmentPurpose, PrismaClient } from '@prisma/client';

import type { AttachmentOwnerKind } from '../application/record-attachment.service.js';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const FILE_SELECT = {
  id: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  lifecycle: true,
  uploadedBy: true,
  createdAt: true,
} as const;

export interface CreateAttachmentData {
  platformFileId: string;
  createdBy: string;
  purpose?: IpcAttachmentPurpose;
}

/**
 * The four attachment tables, behind one interface.
 *
 * Prisma's delegates are separate types with no common supertype, so this switches on the owner
 * kind rather than pretending to be generic. That is on purpose: the alternative is
 * `prisma[modelName]` indexed by a string, which type-checks as `any` and would let a typo reach
 * the wrong table at runtime. Four explicit branches are longer and cannot be wrong.
 */
@Injectable()
export class RecordAttachmentRepository {
  /** The parent, its project, and the state that decides whether its evidence is frozen. */
  async findParent(
    prisma: TenantPrisma,
    organizationId: string,
    kind: AttachmentOwnerKind,
    ownerId: string,
  ): Promise<{ projectId: string; status: string; isEffective?: boolean } | null> {
    switch (kind) {
      case 'CONTRACT': {
        const row = await prisma.contract.findFirst({
          where: { id: ownerId, organizationId },
          select: { projectId: true, status: true },
        });
        return row ? { projectId: row.projectId, status: row.status } : null;
      }
      case 'GUARANTEE': {
        const row = await prisma.contractGuarantee.findFirst({
          where: { id: ownerId, contract: { organizationId } },
          select: { status: true, contract: { select: { projectId: true } } },
        });
        return row ? { projectId: row.contract.projectId, status: row.status } : null;
      }
      case 'IPA': {
        const row = await prisma.interimPaymentApplication.findFirst({
          where: { id: ownerId, organizationId },
          select: { status: true, contract: { select: { projectId: true } } },
        });
        return row ? { projectId: row.contract.projectId, status: row.status } : null;
      }
      case 'IPC': {
        const row = await prisma.interimPaymentCertificate.findFirst({
          where: { id: ownerId, organizationId },
          select: {
            status: true,
            isEffective: true,
            application: { select: { contract: { select: { projectId: true } } } },
          },
        });
        return row
          ? {
              projectId: row.application.contract.projectId,
              status: row.status,
              isEffective: row.isEffective,
            }
          : null;
      }
    }
  }

  list(prisma: TenantPrisma, kind: AttachmentOwnerKind, ownerId: string) {
    switch (kind) {
      case 'CONTRACT':
        return prisma.contractAttachment.findMany({
          where: { contractId: ownerId },
          select: { id: true, createdBy: true, createdAt: true, platformFile: { select: FILE_SELECT } },
          orderBy: { createdAt: 'desc' },
        });
      case 'GUARANTEE':
        return prisma.guaranteeAttachment.findMany({
          where: { guaranteeId: ownerId },
          select: { id: true, createdBy: true, createdAt: true, platformFile: { select: FILE_SELECT } },
          orderBy: { createdAt: 'desc' },
        });
      case 'IPA':
        return prisma.ipaAttachment.findMany({
          where: { applicationId: ownerId },
          select: { id: true, createdBy: true, createdAt: true, platformFile: { select: FILE_SELECT } },
          orderBy: { createdAt: 'desc' },
        });
      case 'IPC':
        return prisma.ipcAttachment.findMany({
          where: { certificateId: ownerId },
          select: {
            id: true,
            createdBy: true,
            createdAt: true,
            purpose: true,
            platformFile: { select: FILE_SELECT },
          },
          orderBy: { createdAt: 'desc' },
        });
    }
  }

  create(
    prisma: TenantPrisma,
    kind: AttachmentOwnerKind,
    ownerId: string,
    data: CreateAttachmentData,
  ) {
    const base = { platformFileId: data.platformFileId, createdBy: data.createdBy };
    switch (kind) {
      case 'CONTRACT':
        return prisma.contractAttachment.create({ data: { ...base, contractId: ownerId } });
      case 'GUARANTEE':
        return prisma.guaranteeAttachment.create({ data: { ...base, guaranteeId: ownerId } });
      case 'IPA':
        return prisma.ipaAttachment.create({ data: { ...base, applicationId: ownerId } });
      case 'IPC':
        return prisma.ipcAttachment.create({
          data: { ...base, certificateId: ownerId, purpose: data.purpose ?? 'SUPPORTING' },
        });
    }
  }

  /** Scoped by BOTH ids: an attachment id alone must never reach a record it does not belong to. */
  findOwned(
    prisma: TenantPrisma,
    kind: AttachmentOwnerKind,
    ownerId: string,
    attachmentId: string,
  ) {
    const select = {
      id: true,
      platformFileId: true,
      platformFile: { select: { lifecycle: true } },
    } as const;
    switch (kind) {
      case 'CONTRACT':
        return prisma.contractAttachment.findFirst({
          where: { id: attachmentId, contractId: ownerId },
          select,
        });
      case 'GUARANTEE':
        return prisma.guaranteeAttachment.findFirst({
          where: { id: attachmentId, guaranteeId: ownerId },
          select,
        });
      case 'IPA':
        return prisma.ipaAttachment.findFirst({
          where: { id: attachmentId, applicationId: ownerId },
          select,
        });
      case 'IPC':
        return prisma.ipcAttachment.findFirst({
          where: { id: attachmentId, certificateId: ownerId },
          select,
        });
    }
  }

  delete(prisma: TenantPrisma, kind: AttachmentOwnerKind, attachmentId: string) {
    switch (kind) {
      case 'CONTRACT':
        return prisma.contractAttachment.delete({ where: { id: attachmentId } });
      case 'GUARANTEE':
        return prisma.guaranteeAttachment.delete({ where: { id: attachmentId } });
      case 'IPA':
        return prisma.ipaAttachment.delete({ where: { id: attachmentId } });
      case 'IPC':
        return prisma.ipcAttachment.delete({ where: { id: attachmentId } });
    }
  }

  async findFileIds(
    prisma: TenantPrisma,
    kind: AttachmentOwnerKind,
    ownerId: string,
  ): Promise<string[]> {
    const rows = await this.list(prisma, kind, ownerId);
    return rows.map((row) => row.platformFile.id);
  }

  findFileStatus(prisma: TenantPrisma, organizationId: string, fileId: string) {
    return prisma.platformFile.findFirst({
      where: { id: fileId, organizationId },
      select: { id: true, status: true, lifecycle: true, uploadedBy: true },
    });
  }
}
