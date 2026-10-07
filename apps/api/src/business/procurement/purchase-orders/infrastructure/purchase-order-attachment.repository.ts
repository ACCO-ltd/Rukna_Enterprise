import { Injectable } from '@nestjs/common';
import type { PoRevisionAttachmentPurpose, PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface AttachToRevisionData {
  organizationId: string;
  purchaseOrderRevisionId: string;
  platformFileId: string;
  purpose: PoRevisionAttachmentPurpose;
  supplierRef?: string;
  attachedBy: string;
}

@Injectable()
export class PurchaseOrderAttachmentRepository {
  attachToRevision(prisma: TenantPrisma, data: AttachToRevisionData) {
    return prisma.purchaseOrderRevisionAttachment.create({ data });
  }

  /**
   * ADR-044 §8 — attach already-IMMUTABLE evidence (the winning quotation photos) to a draft
   * revision. An internal path: the public attach rule (TEMPORARY and uploaded by the caller) is for
   * fresh uploads, not for evidence another record already froze. The files' lifecycle is untouched.
   */
  async attachImmutableEvidence(
    prisma: TenantPrisma,
    data: {
      organizationId: string;
      purchaseOrderRevisionId: string;
      platformFileIds: string[];
      purpose: PoRevisionAttachmentPurpose;
      supplierRef?: string;
      attachedBy: string;
    },
  ) {
    if (data.platformFileIds.length === 0) return;
    const files = await prisma.platformFile.findMany({
      where: { id: { in: data.platformFileIds }, organizationId: data.organizationId, lifecycle: 'IMMUTABLE' },
      select: { id: true },
    });
    if (files.length !== new Set(data.platformFileIds).size) {
      throw new Error('Quotation evidence must be immutable files of this organization');
    }
    await prisma.purchaseOrderRevisionAttachment.createMany({
      data: data.platformFileIds.map((platformFileId) => ({
        organizationId: data.organizationId,
        purchaseOrderRevisionId: data.purchaseOrderRevisionId,
        platformFileId,
        purpose: data.purpose,
        supplierRef: data.supplierRef,
        attachedBy: data.attachedBy,
      })),
    });
  }

  listByRevision(prisma: TenantPrisma, purchaseOrderRevisionId: string) {
    return prisma.purchaseOrderRevisionAttachment.findMany({
      where: { purchaseOrderRevisionId },
      include: {
        file: {
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            status: true,
            lifecycle: true,
            // ADR-044 — a quotation photo carries supplier prices (see listRevisionAttachments).
            quotePhoto: { select: { id: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * BOUND → IMMUTABLE for every file on a revision that has just been confirmed (ACTIVE).
   *
   * Uses PlatformFileRepository's `setLifecycleMany` pattern: collect ids, then updateMany
   * scoped to `lifecycle: { not: 'IMMUTABLE' }` so the call is idempotent.
   */
  async freezeRevisionAttachments(prisma: TenantPrisma, purchaseOrderRevisionId: string): Promise<void> {
    const rows = await prisma.purchaseOrderRevisionAttachment.findMany({
      where: { purchaseOrderRevisionId },
      select: { platformFileId: true },
    });
    if (rows.length === 0) return;
    const fileIds = rows.map((r) => r.platformFileId);
    await prisma.platformFile.updateMany({
      where: { id: { in: fileIds }, lifecycle: { not: 'IMMUTABLE' } },
      data: { lifecycle: 'IMMUTABLE', lifecycleReason: `po-revision confirmed ${purchaseOrderRevisionId}`.slice(0, 120) },
    });
  }

  findFileStatus(prisma: TenantPrisma, organizationId: string, platformFileId: string) {
    return prisma.platformFile.findFirst({
      where: { id: platformFileId, organizationId },
      select: { id: true, status: true, lifecycle: true, uploadedBy: true },
    });
  }
}
