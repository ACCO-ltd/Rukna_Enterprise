import { Injectable } from '@nestjs/common';
import type { PrismaClient, CommitmentStage, CommitmentSourceDocType } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateCommitmentEntryData {
  organizationId: string;
  projectId?: string;
  boqNodeId?: string;
  departmentId?: string;
  costCenterId?: string;
  materialId?: string;
  supplierId?: string;
  purchaseOrderId?: string;
  spendCategoryId?: string;
  stage: CommitmentStage;
  amount: Decimal;
  currencyCode: string;
  reportingAmount: Decimal;
  sourceDocumentType: CommitmentSourceDocType;
  sourceDocumentId: string;
  sourceLineId?: string;
  sourceRevision?: number;
  eventType: string;
  idempotencyKey: string;
  occurredAt: Date;
  accountingDate: Date;
}

@Injectable()
export class CommitmentLedgerRepository {
  create(prisma: TenantPrisma, data: CreateCommitmentEntryData) {
    return prisma.commitmentLedgerEntry.create({ data });
  }

  findByIdempotencyKey(prisma: TenantPrisma, key: string) {
    return prisma.commitmentLedgerEntry.findUnique({ where: { idempotencyKey: key } });
  }

  // Idempotency guard for a multi-row movement (e.g. a bill's per-line ACTUAL, A14/D7): true once any
  // entry for this source document at this stage exists, so a retry short-circuits the whole movement.
  async existsForSourceAndStage(
    prisma: TenantPrisma,
    sourceDocumentType: CommitmentSourceDocType,
    sourceDocumentId: string,
    stage: CommitmentStage,
  ): Promise<boolean> {
    const row = await prisma.commitmentLedgerEntry.findFirst({
      where: { sourceDocumentType, sourceDocumentId, stage },
      select: { id: true },
    });
    return row !== null;
  }

  queryByProject(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    filters?: { stage?: CommitmentStage; boqNodeId?: string },
  ) {
    return prisma.commitmentLedgerEntry.findMany({
      where: {
        organizationId,
        projectId,
        ...(filters?.stage ? { stage: filters.stage } : {}),
        ...(filters?.boqNodeId ? { boqNodeId: filters.boqNodeId } : {}),
      },
      orderBy: { occurredAt: 'desc' },
    });
  }

  queryByPo(prisma: TenantPrisma, organizationId: string, purchaseOrderId: string) {
    return prisma.commitmentLedgerEntry.findMany({
      where: { organizationId, purchaseOrderId },
      orderBy: { occurredAt: 'asc' },
    });
  }

  queryByPoLineAndStage(
    prisma: TenantPrisma,
    organizationId: string,
    purchaseOrderId: string,
    sourceLineId: string,
    stage: CommitmentStage,
  ) {
    return prisma.commitmentLedgerEntry.findMany({
      where: { organizationId, purchaseOrderId, sourceLineId, stage },
      select: { amount: true },
      orderBy: { occurredAt: 'asc' },
    });
  }

  async summarizeByProject(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
  ): Promise<{ committed: Decimal; accrued: Decimal; actual: Decimal }> {
    const rows = await prisma.commitmentLedgerEntry.groupBy({
      by: ['stage'],
      where: { organizationId, projectId },
      _sum: { reportingAmount: true },
    });

    const get = (stage: CommitmentStage): Decimal => {
      const row = rows.find(r => r.stage === stage);
      return (row?._sum?.reportingAmount as Decimal | null) ?? (0 as unknown as Decimal);
    };

    return { committed: get('COMMITTED'), accrued: get('ACCRUED'), actual: get('ACTUAL') };
  }
}
