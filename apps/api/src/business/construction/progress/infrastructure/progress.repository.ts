import { Injectable } from '@nestjs/common';
import type { PrismaClient, Prisma } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class ProgressRepository {
  createDpr(prisma: TenantPrisma, data: Prisma.DailyProgressReportUncheckedCreateInput) {
    return prisma.dailyProgressReport.create({ data });
  }

  findDpr(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.dailyProgressReport.findFirst({
      where: { id, organizationId },
      include: {
        measurements: {
          include: { boqNode: { select: { code: true, description: true, quantity: true } } },
        },
        attachments: {
          include: { platformFile: { select: { originalName: true, mimeType: true, status: true } } },
        },
      },
    });
  }

  findDprsByProject(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.dailyProgressReport.findMany({
      where: { organizationId, projectId },
      orderBy: { reportDate: 'desc' },
    });
  }

  updateDprStatus(
    prisma: TenantPrisma,
    id: string,
    data: Prisma.DailyProgressReportUncheckedUpdateInput,
  ) {
    return prisma.dailyProgressReport.update({ where: { id }, data });
  }

  addMeasurement(prisma: TenantPrisma, data: Prisma.ProgressMeasurementUncheckedCreateInput) {
    return prisma.progressMeasurement.create({ data });
  }

  createAttachment(prisma: TenantPrisma, data: Prisma.DprAttachmentUncheckedCreateInput) {
    return prisma.dprAttachment.create({ data });
  }

  /** The BOQ leaf must belong to this project's BOQ. Returns the measurable quantity + leaf flag. */
  findBoqNodeForProject(prisma: TenantPrisma, projectId: string, boqNodeId: string) {
    return prisma.boqNode.findFirst({
      where: { id: boqNodeId, version: { boq: { projectId } } },
      select: { id: true, quantity: true, isLeaf: true },
    });
  }

  /** Σ of verified (APPROVED-DPR) measured quantity for a BOQ node, optionally excluding one DPR. */
  sumVerifiedForNode(
    prisma: TenantPrisma,
    organizationId: string,
    boqNodeId: string,
    excludeDprId?: string,
  ) {
    return prisma.progressMeasurement.aggregate({
      _sum: { quantity: true },
      where: {
        organizationId,
        boqNodeId,
        dpr: { status: 'APPROVED' },
        ...(excludeDprId ? { dprId: { not: excludeDprId } } : {}),
      },
    });
  }

  approvedMeasurementsForProject(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.progressMeasurement.findMany({
      where: { organizationId, dpr: { projectId, status: 'APPROVED' } },
      include: { boqNode: { select: { id: true, code: true, description: true, quantity: true } } },
    });
  }

  findFileStatus(prisma: TenantPrisma, organizationId: string, fileId: string) {
    return prisma.platformFile.findFirst({
      where: { id: fileId, organizationId },
      select: { id: true, status: true },
    });
  }
}
