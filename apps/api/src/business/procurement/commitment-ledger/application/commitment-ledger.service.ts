import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import type { CommitmentStage } from '@prisma/client';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { CommitmentLedgerRepository } from '../infrastructure/commitment-ledger.repository.js';

@Injectable()
export class CommitmentLedgerService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: CommitmentLedgerRepository,
  ) {}

  queryByProject(
    identity: RequestIdentity,
    projectId: string,
    filters?: { stage?: CommitmentStage; boqNodeId?: string },
  ) {
    const prisma = this.tenancy.getClient();
    return this.repo.queryByProject(prisma, identity.activeOrganizationId, projectId, filters);
  }

  queryByPo(identity: RequestIdentity, purchaseOrderId: string) {
    const prisma = this.tenancy.getClient();
    return this.repo.queryByPo(prisma, identity.activeOrganizationId, purchaseOrderId);
  }

  summarizeByProject(identity: RequestIdentity, projectId: string) {
    const prisma = this.tenancy.getClient();
    return this.repo.summarizeByProject(prisma, identity.activeOrganizationId, projectId);
  }
}
