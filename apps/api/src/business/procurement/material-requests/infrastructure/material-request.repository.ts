import { Injectable } from '@nestjs/common';
import type {
  PrismaClient,
  MaterialRequestStatus,
  MaterialRequestScope,
  MaterialRequestPriority,
  ProcurementLineType,
} from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateMrLineData {
  lineNumber: number;
  lineType: ProcurementLineType;
  materialId?: string;
  description: string;
  unitOfMeasureId: string;
  requestedQuantity: Decimal;
  /** The requester's estimate. ADR-022 routes approval on the value it produces. */
  estimatedUnitPrice?: Decimal;
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
  title?: string;
  currencyCode?: string;
  priority?: MaterialRequestPriority;
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
    filters?: {
      status?: MaterialRequestStatus;
      projectId?: string;
      scope?: MaterialRequestScope;
      /** Free-text: MR number or title, or a project in `searchProjectIds`. */
      search?: string;
      searchProjectIds?: string[];
    },
    accessibleProjectIds?: string[],
  ) {
    const search = filters?.search?.trim();
    return prisma.materialRequest.findMany({
      where: {
        organizationId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.projectId ? { projectId: filters.projectId } : {}),
        ...(filters?.scope ? { requestScope: filters.scope } : {}),
        AND: [
          accessibleProjectIds
            ? {
                OR: [
                  { requestScope: 'ORGANIZATION' },
                  { projectId: { in: accessibleProjectIds } },
                ],
              }
            : {},
          search
            ? {
                OR: [
                  { mrNumber: { contains: search, mode: 'insensitive' } },
                  { title: { contains: search, mode: 'insensitive' } },
                  ...(filters?.searchProjectIds?.length
                    ? [{ projectId: { in: filters.searchProjectIds } }]
                    : []),
                ],
              }
            : {},
        ],
      },
      include: MR_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Projects in the org whose code or name contains `search` (MR list free-text search). */
  async findProjectIdsMatching(prisma: TenantPrisma, organizationId: string, search: string) {
    const rows = await prisma.project.findMany({
      where: {
        organizationId,
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  findProjectLabels(prisma: TenantPrisma, organizationId: string, ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return prisma.project.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, code: true, name: true },
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

  /**
   * Moves the request to `status`. With `expectedStatus`, the write only lands while the row is
   * still in that status (compare-and-set) and returns null otherwise.
   */
  async updateStatus(
    prisma: TenantPrisma,
    id: string,
    status: MaterialRequestStatus,
    extra?: { approvalInstanceId?: string; expectedStatus?: MaterialRequestStatus },
  ) {
    const { expectedStatus, ...data } = extra ?? {};
    if (expectedStatus) {
      const { count } = await prisma.materialRequest.updateMany({
        where: { id, status: expectedStatus },
        data: { status, ...data },
      });
      if (count === 0) return null;
      return prisma.materialRequest.findUniqueOrThrow({ where: { id }, include: MR_INCLUDE });
    }
    return prisma.materialRequest.update({
      where: { id },
      data: { status, ...data },
      include: MR_INCLUDE,
    });
  }

  /**
   * On approval each line is approved for what was requested, unless a quantity was already
   * set. Returns the request re-read with its lines. Runs inside the approve transaction.
   */
  async approveRequestedQuantities(prisma: TenantPrisma, id: string) {
    await prisma.$executeRaw`
      UPDATE material_request_lines
         SET approved_quantity = requested_quantity
       WHERE material_request_id = ${id}
         AND approved_quantity IS NULL`;
    return prisma.materialRequest.findUniqueOrThrow({ where: { id }, include: MR_INCLUDE });
  }

  nextMrNumber(prisma: TenantPrisma, organizationId: string): Promise<number> {
    return prisma.materialRequest.count({ where: { organizationId } }).then(n => n + 1);
  }
}
