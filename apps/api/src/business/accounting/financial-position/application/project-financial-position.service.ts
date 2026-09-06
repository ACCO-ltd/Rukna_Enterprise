import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { ProjectFinancialPositionResponse, RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectFinancialPositionRepository } from '../infrastructure/project-financial-position.repository.js';
import { calculateFinancialPosition } from './financial-position.policy.js';

/**
 * Project Financial Position (ADR-013): the PM/control view — what the project has
 * spent, what it has committed to spend, and what it budgeted to spend.
 *
 * Scope of this cut:
 *  - Single currency. Amounts are combined in the contract currency; the GL and
 *    commitment reporting amounts are assumed to be the same currency (ACCO is
 *    USD-only). Multi-currency conversion via approved-rate snapshots (ADR-010
 *    `toReportingAmount`) is a follow-up.
 *  - **No forecast.** `forecastCost` / `forecastMargin` were removed: they were
 *    actual-plus-commitments wearing a forecast's name, with no estimate of remaining
 *    cost in them at all, so they could only ever flatter margin. See the policy.
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
    const [contract, stages, actualCost, budget] = await Promise.all([
      this.repo.findMainContract(prisma, orgId, projectId),
      this.repo.sumCommitmentStages(prisma, orgId, projectId),
      this.repo.sumActualCost(prisma, orgId, projectId),
      this.repo.sumBaselinedBudget(prisma, orgId, projectId),
    ]);

    const costInputs = {
      openCommitment: stages.openCommitment,
      accruedCost: stages.accruedCost,
      actualCost,
      budgetTotal: budget?.total ?? null,
    };

    // No main contract: cost and budget are real, revenue is unavailable (not zero).
    if (!contract) {
      const position = calculateFinancialPosition({
        contractValue: new Decimal(0),
        certifiedRevenue: new Decimal(0),
        invoicedRevenue: new Decimal(0),
        cashReceived: new Decimal(0),
        postedReceiptAllocations: new Decimal(0),
        ...costInputs,
      });
      return {
        projectId,
        currency: budget?.currency ?? null,
        hasContract: false,
        hasBudget: budget !== null,
        contractValue: null,
        certifiedRevenue: null,
        invoicedRevenue: null,
        receivedRevenue: null,
        outstandingReceivables: null,
        budgetTotal: budget === null ? null : position.budgetTotal!.toFixed(2),
        openCommitment: position.openCommitment.toFixed(2),
        accruedCost: position.accruedCost.toFixed(2),
        actualCost: position.actualCost.toFixed(2),
        committedToDate: position.committedToDate.toFixed(2),
        uncommittedBudget:
          position.uncommittedBudget === null ? null : position.uncommittedBudget.toFixed(2),
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
      ...costInputs,
    });

    return {
      projectId,
      currency: contract.currency,
      hasContract: true,
      hasBudget: budget !== null,
      contractValue: position.contractValue.toFixed(2),
      certifiedRevenue: position.certifiedRevenue.toFixed(2),
      invoicedRevenue: position.invoicedRevenue.toFixed(2),
      receivedRevenue: settlement.received.toFixed(2),
      outstandingReceivables: position.outstandingReceivables.toFixed(2),
      budgetTotal: position.budgetTotal === null ? null : position.budgetTotal.toFixed(2),
      openCommitment: position.openCommitment.toFixed(2),
      accruedCost: position.accruedCost.toFixed(2),
      actualCost: position.actualCost.toFixed(2),
      committedToDate: position.committedToDate.toFixed(2),
      uncommittedBudget:
        position.uncommittedBudget === null ? null : position.uncommittedBudget.toFixed(2),
      asOf,
    };
  }
}
