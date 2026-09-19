import { Injectable } from '@nestjs/common';
import type { GrnAttachmentPurpose, PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface AttachToGrnData {
  organizationId: string;
  goodsReceiptNoteId: string;
  platformFileId: string;
  purpose: GrnAttachmentPurpose;
  attachedBy: string;
}

@Injectable()
export class GrnAttachmentRepository {
  attachToGrn(prisma: TenantPrisma, data: AttachToGrnData) {
    return prisma.goodsReceiptAttachment.create({ data });
  }

  listByGrn(prisma: TenantPrisma, goodsReceiptNoteId: string) {
    return prisma.goodsReceiptAttachment.findMany({
      where: { goodsReceiptNoteId },
      include: { file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, status: true, lifecycle: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * BOUND → IMMUTABLE for every file on a GRN that has just been posted.
   *
   * Idempotent: scoped to `lifecycle: { not: 'IMMUTABLE' }`.
   */
  async freezeGrnAttachments(prisma: TenantPrisma, goodsReceiptNoteId: string): Promise<void> {
    const rows = await prisma.goodsReceiptAttachment.findMany({
      where: { goodsReceiptNoteId },
      select: { platformFileId: true },
    });
    if (rows.length === 0) return;
    const fileIds = rows.map((r) => r.platformFileId);
    await prisma.platformFile.updateMany({
      where: { id: { in: fileIds }, lifecycle: { not: 'IMMUTABLE' } },
      data: { lifecycle: 'IMMUTABLE', lifecycleReason: `grn posted ${goodsReceiptNoteId}`.slice(0, 120) },
    });
  }

  findFileStatus(prisma: TenantPrisma, organizationId: string, platformFileId: string) {
    return prisma.platformFile.findFirst({
      where: { id: platformFileId, organizationId },
      select: { id: true, status: true, lifecycle: true, uploadedBy: true },
    });
  }
}
