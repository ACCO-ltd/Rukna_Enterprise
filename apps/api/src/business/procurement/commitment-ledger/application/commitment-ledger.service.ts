import { Injectable } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import type { CommitmentStage } from '@prisma/client';
import type { LabelSource } from '../infrastructure/commitment-entry-labels.repository.js';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { CommitmentLedgerRepository } from '../infrastructure/commitment-ledger.repository.js';
import { CommitmentEntryLabelsRepository } from '../infrastructure/commitment-entry-labels.repository.js';

@Injectable()
export class CommitmentLedgerService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: CommitmentLedgerRepository,
    private readonly labels: CommitmentEntryLabelsRepository,
  ) {}

  /** Ledger rows plus `documentNumber`, `supplierName` and `boqNode` (batch-resolved). */
  async queryByProject(
    identity: RequestIdentity,
    projectId: string,
    filters?: { stage?: CommitmentStage; boqNodeId?: string },
  ) {
    const prisma = this.tenancy.getClient();
    const rows = await this.repo.queryByProject(prisma, identity.activeOrganizationId, projectId, filters);
    return this.withLabels(identity, rows);
  }

  async queryByPo(identity: RequestIdentity, purchaseOrderId: string) {
    const prisma = this.tenancy.getClient();
    const rows = await this.repo.queryByPo(prisma, identity.activeOrganizationId, purchaseOrderId);
    return this.withLabels(identity, rows);
  }

  private async withLabels<T extends LabelSource>(identity: RequestIdentity, rows: T[]) {
    const labels = await this.labels.resolve(this.tenancy.getClient(), identity.activeOrganizationId, rows);
    return rows.map((row, i) => ({ ...row, ...labels[i] }));
  }

  summarizeByProject(identity: RequestIdentity, projectId: string) {
    const prisma = this.tenancy.getClient();
    return this.repo.summarizeByProject(prisma, identity.activeOrganizationId, projectId);
  }
}
