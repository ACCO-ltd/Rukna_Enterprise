import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const FILE_SELECT = {
  id: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  lifecycle: true,
  uploadedBy: true,
  createdAt: true,
} as const;

/**
 * Reads the attachment tables that other aggregates own.
 *
 * **Five separate queries, deliberately not a union view.** Each parent reaches the project by a
 * different path — a DPR holds `projectId` directly, a contract too, a guarantee through its
 * contract, an IPA through its contract, an IPC through its application's contract — and every one
 * of those joins is the scoping that keeps another project's evidence out of this list. A single
 * generic query would have to reproduce all five joins anyway, in a form no one could check.
 *
 * The join is also the authorization boundary: rows are selected *through* the parent's project,
 * so a caller who is not a member of this project cannot receive a row at all, before the file
 * authorization service is ever consulted for the bytes.
 */
@Injectable()
export class LinkedAttachmentRepository {
  findDprAttachments(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.dprAttachment.findMany({
      where: { dpr: { projectId, organizationId } },
      select: {
        id: true,
        createdBy: true,
        platformFile: { select: FILE_SELECT },
        dpr: { select: { id: true, reportDate: true, status: true } },
      },
    });
  }

  findContractAttachments(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.contractAttachment.findMany({
      where: { contract: { projectId, organizationId } },
      select: {
        id: true,
        createdBy: true,
        createdAt: true,
        platformFile: { select: FILE_SELECT },
        contract: { select: { id: true, contractNumber: true, contractKind: true } },
      },
    });
  }

  findGuaranteeAttachments(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.guaranteeAttachment.findMany({
      where: { guarantee: { contract: { projectId, organizationId } } },
      select: {
        id: true,
        createdBy: true,
        createdAt: true,
        platformFile: { select: FILE_SELECT },
        guarantee: {
          select: {
            id: true,
            reference: true,
            guaranteeType: true,
            contract: { select: { id: true, contractNumber: true } },
          },
        },
      },
    });
  }

  findIpaAttachments(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.ipaAttachment.findMany({
      where: { application: { organizationId, contract: { projectId } } },
      select: {
        id: true,
        createdBy: true,
        createdAt: true,
        platformFile: { select: FILE_SELECT },
        application: {
          select: { id: true, applicationRef: true, applicationNumber: true, contractId: true },
        },
      },
    });
  }

  findIpcAttachments(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.ipcAttachment.findMany({
      where: { certificate: { organizationId, application: { contract: { projectId } } } },
      select: {
        id: true,
        createdBy: true,
        createdAt: true,
        purpose: true,
        platformFile: { select: FILE_SELECT },
        certificate: {
          select: {
            id: true,
            certificateNumber: true,
            certificateRef: true,
            applicationId: true,
            isEffective: true,
          },
        },
      },
    });
  }
}
