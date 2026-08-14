import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { ProjectFinancialPositionResponse, RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectFinancialPositionRepository } from '../infrastructure/project-financial-position.repository.js';
import { calculateFinancialPosition } from './financial-position.policy.js';

/**
 * Project Financial Position (ADR-013): the PM/control view — posted actuals **plus** remaining
 * committed cost, so forecast margin is not overstated. Built on the org-level FP policy
 * (`calculateFinancialPosition`, ADR-010) with project-scoped inputs.
 *
 * Scope of this first cut (flagged for confirmation with Eng Ahmed):
 *  - Single currency. Amounts are combined in the contract currency; the GL and commitment
 *    reporting amounts are assumed to be the same currency (ACCO is USD-only). Multi-currency
 *    conversion via approved-rate snapshots (ADR-010 `toReportingAmount`) is a follow-up.
 *  - `remainingCommitments` = COMMITTED + ACCRUED (excludes ACTUAL, already in GL actual cost).
 */
@Injectable()
export class ProjectFinancialPositionService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: ProjectFinancialPositionRepository,
  ) {}

  async getForProject(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<ProjectFinancialPositionResponse> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const asOf = new Date().toISOString();

    // Cost side does not depend on a contract — always resolved.
    const [contract, remainingCommitments, actualCost] = await Promise.all([
      this.repo.findMainContract(prisma, orgId, projectId),
      this.repo.sumRemainingCommitments(prisma, orgId, projectId),
      this.repo.sumActualCost(prisma, orgId, projectId),
    ]);

    const forecastCost = actualCost.plus(remainingCommitments);

    // No main contract: cost/forecast are real, revenue and margin are unavailable (not zero).
    if (!contract) {
      return {
        projectId,
        currency: null,
        hasContract: false,
        contractValue: null,
        certifiedRevenue: null,
        invoicedRevenue: null,
        receivedRevenue: null,
        outstandingReceivables: null,
        actualCost: actualCost.toFixed(2),
        remainingCommitments: remainingCommitments.toFixed(2),
        forecastCost: forecastCost.toFixed(2),
        forecastMargin: null,
        asOf,
      };
    }

    const [certifiedRevenue, settlement] = await Promise.all([
      this.repo.sumCertifiedRevenue(prisma, orgId, contract.id),
      this.repo.sumSettlement(prisma, orgId, contract.id),
    ]);

    const position = calculateFinancialPosition({
      contractValue: new Decimal(contract.contractValue.toString()),
      certifiedRevenue,
      invoicedRevenue: settlement.invoiced,
      cashReceived: settlement.received,
      postedReceiptAllocations: settlement.received,
      remainingCommitments,
      actualCost,
    });

    return {
      projectId,
      currency: contract.currency,
      hasContract: true,
      contractValue: position.contractValue.toFixed(2),
      certifiedRevenue: position.certifiedRevenue.toFixed(2),
      invoicedRevenue: position.invoicedRevenue.toFixed(2),
      receivedRevenue: settlement.received.toFixed(2),
      outstandingReceivables: position.outstandingReceivables.toFixed(2),
      actualCost: position.actualCost.toFixed(2),
      remainingCommitments: position.remainingCommitments.toFixed(2),
      forecastCost: position.forecastCost.toFixed(2),
      forecastMargin: position.forecastMargin.toFixed(2),
      asOf,
    };
  }
}
