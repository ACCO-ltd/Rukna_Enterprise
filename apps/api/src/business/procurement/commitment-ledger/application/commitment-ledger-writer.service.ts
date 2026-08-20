import { Injectable } from '@nestjs/common';
import type { PrismaClient, CommitmentStage, CommitmentSourceDocType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CommitmentLedgerRepository } from '../infrastructure/commitment-ledger.repository.js';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CommitmentWriteInput {
  organizationId: string;
  supplierId?: string;
  purchaseOrderId?: string;
  spendCategoryId?: string;
  currencyCode: string;
  amount: Decimal;
  accountingDate: Date;
  sourceDocumentType: CommitmentSourceDocType;
  sourceDocumentId: string;
  sourceLineId?: string;
  sourceRevision?: number;
  eventType: string;
  idempotencyKey: string;
}

@Injectable()
export class CommitmentLedgerWriter {
  constructor(private readonly repo: CommitmentLedgerRepository) {}

  committed(prisma: TenantPrisma, input: CommitmentWriteInput) {
    return this.write(prisma, 'COMMITTED', input);
  }

  accrued(prisma: TenantPrisma, input: CommitmentWriteInput) {
    return this.write(prisma, 'ACCRUED', input);
  }

  actual(prisma: TenantPrisma, input: CommitmentWriteInput) {
    return this.write(prisma, 'ACTUAL', input);
  }

  findByIdempotencyKey(prisma: TenantPrisma, key: string) {
    return this.repo.findByIdempotencyKey(prisma, key);
  }

  queryByPoLineAndStage(
    prisma: TenantPrisma,
    organizationId: string,
    purchaseOrderId: string,
    sourceLineId: string,
    stage: CommitmentStage,
  ) {
    return this.repo.queryByPoLineAndStage(prisma, organizationId, purchaseOrderId, sourceLineId, stage);
  }

  private write(prisma: TenantPrisma, stage: CommitmentStage, input: CommitmentWriteInput) {
    const { amount, ...rest } = input;
    return this.repo.create(prisma, {
      ...rest,
      stage,
      amount,
      // Single-currency (USD): the reporting amount is the amount (ADR-024).
      reportingAmount: amount,
      occurredAt: new Date(),
    });
  }
}
