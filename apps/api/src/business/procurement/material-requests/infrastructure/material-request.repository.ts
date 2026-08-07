import { Injectable } from '@nestjs/common';
import type { PrismaClient, MaterialRequestStatus, MaterialRequestScope, ProcurementLineType } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateMrLineData {
  lineNumber: number;
  lineType: ProcurementLineType;
  materialId?: string;
  description: string;
  unitOfMeasureId: string;
  requestedQuantity: Decimal;
  boqNodeId?: string;
  spendCategoryId?: string;
  departmentId?: string;
  costCenterId?: string;
  projectCostCategoryId?: string;
  notes?: string;
}

export interface CreateMrData {
  organizationId: string;
  mrNumber: string;
  requestScope: MaterialRequestScope;
  projectId?: string;
  requestedBy: string;
  requestedDate: Date;
  requiredByDate?: Date;
  description?: string;
  notes?: string;
  lines: CreateMrLineData[];
}

const MR_INCLUDE = {
  lines: {
    include: { material: true, uom: true, spendCategory: true },
    orderBy: { lineNumber: 'asc' as const },
  },
} as const;

@Injectable()
export class MaterialRequestRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.materialRequest.findFirst({
      where: { id, organizationId },
      include: MR_INCLUDE,
    });
  }

  findAll(
    prisma: TenantPrisma,
    organizationId: string,
    filters?: { status?: MaterialRequestStatus; projectId?: string; scope?: MaterialRequestScope },
  ) {
    return prisma.materialRequest.findMany({
      where: {
        organizationId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.projectId ? { projectId: filters.projectId } : {}),
        ...(filters?.scope ? { requestScope: filters.scope } : {}),
      },
      include: MR_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(prisma: TenantPrisma, data: CreateMrData) {
    const { lines, ...header } = data;
    return prisma.materialRequest.create({
      data: {
        ...header,
        lines: { create: lines },
      },
      include: MR_INCLUDE,
    });
  }

  updateStatus(prisma: TenantPrisma, id: string, status: MaterialRequestStatus, extra?: { approvalInstanceId?: string }) {
    return prisma.materialRequest.update({
      where: { id },
      data: { status, ...extra },
      include: MR_INCLUDE,
    });
  }

  nextMrNumber(prisma: TenantPrisma, organizationId: string): Promise<number> {
    return prisma.materialRequest.count({ where: { organizationId } }).then(n => n + 1);
  }
}
