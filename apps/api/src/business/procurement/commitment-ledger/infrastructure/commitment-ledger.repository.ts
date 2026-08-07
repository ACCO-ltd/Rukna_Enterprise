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
  exchangeRateSnapshot: Decimal;
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
