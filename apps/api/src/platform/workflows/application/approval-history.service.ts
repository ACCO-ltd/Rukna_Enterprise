import { Injectable } from '@nestjs/common';
import type { WorkflowTransactionType } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import { loadActorNames } from '../../users/application/actor-names.js';
import { deriveApprovalSteps, type ApprovalInstanceView } from '../domain/approval-history.js';

/**
 * The approval chain(s) raised for one document (ADR-036).
 *
 * A read service for document pages: callers own authorisation — they must already have
 * confirmed the viewer may read the document itself. `ApprovalInstance` carries no
 * organisation column, so the organisation is enforced through its definition.
 */
@Injectable()
export class ApprovalHistoryService {
  constructor(private readonly tenancyService: TenancyService) {}

  async forTransaction(
    organizationId: string,
    transactionType: WorkflowTransactionType,
    transactionId: string,
  ): Promise<ApprovalInstanceView[]> {
    const prisma = this.tenancyService.getClient();
    const instances = await prisma.approvalInstance.findMany({
      where: { transactionId, transactionType, definition: { organizationId } },
      include: {
        definition: { select: { name: true, steps: { orderBy: { stepOrder: 'asc' } } } },
        actions: { orderBy: { actedAt: 'asc' } },
      },
      orderBy: { initiatedAt: 'desc' },
    });
    if (instances.length === 0) return [];

    const actorName = await loadActorNames(
      prisma,
      instances.flatMap((i) => [i.initiatedBy, ...i.actions.map((a) => a.actorId)]),
    );

    return instances.map((instance) => ({
      id: instance.id,
      status: instance.status,
      policyName: instance.definition.name,
      initiatedAt: instance.initiatedAt.toISOString(),
      initiatedBy: { id: instance.initiatedBy, name: actorName(instance.initiatedBy) },
      evaluatedAmount: instance.evaluatedAmount?.toFixed(2) ?? null,
      steps: deriveApprovalSteps(
        {
          status: instance.status,
          currentStepOrder: instance.currentStepOrder,
          steps: instance.definition.steps,
          actions: instance.actions,
        },
        actorName,
      ),
    }));
  }
}
