import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { BoqVersioningService } from '../../boq/application/boq-versioning.service.js';
import { ContractService } from '../../contracts/application/contract.service.js';
import { VariationOrderPrismaRepository } from '../infrastructure/variation-order-prisma.repository.js';
import type { ReverseVariationDto } from '../presentation/dto/lifecycle.dto.js';

/**
 * variation-collapse — reverse (un-adopt) a variation that was raised-and-adopted in one step.
 *
 * The inverse of ApplyVariationToBoqService: it takes a CLIENT_APPROVED, BOQ-adopted, UNBILLED VO and,
 * in ONE transaction, retracts its scope from the committed BOQ (hard-deletes its nodes + cuts a fresh
 * reduced snapshot), lowers the current contract value by the VO net, clears the applied marker, and
 * moves the VO to WITHDRAWN. Same DI shape as ApplyVariationToBoqService.
 *
 * Guards (all 409): the VO must be CLIENT_APPROVED; it must be adopted (boqAppliedAt set); and it must
 * be UNBILLED — a VO with any billing allocation cannot be reversed here ("reverse the invoice first"),
 * because that would strip scope a client has already been billed for. Only once the VO is proven
 * unbilled is the hard-delete of its BOQ nodes safe (no financial record references them).
 */
@Injectable()
export class ReverseVariationService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: VariationOrderPrismaRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly boqVersioning: BoqVersioningService,
    private readonly contracts: ContractService,
  ) {}

  async reverse(
    identity: RequestIdentity,
    id: string,
    dto: ReverseVariationDto,
  ): Promise<{ variationId: string; reference: string; projectId: string; boqVersionId: string; snapshotVersionId: string; removedCount: number; newContractValue: string; reversedAt: string }> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const vo = await this.repo.findForApply(prisma, orgId, id);
    if (!vo) throw new NotFoundException(`Variation ${id} not found`);
    await this.projectAccess.assertContract(identity, vo.contractId);

    // Guard 1 — only a client-approved VO holds real entitlement to reverse.
    if (vo.status !== 'CLIENT_APPROVED') {
      throw new ConflictException(
        `Cannot reverse variation ${vo.reference} in status '${vo.status}' — only a CLIENT_APPROVED ` +
          `variation can be reversed.`,
      );
    }

    // Guard 2 — only an adopted VO has scope on the BOQ + a raised contract value to unwind.
    if (vo.boqAppliedAt == null) {
      throw new ConflictException(
        `Variation ${vo.reference} is not adopted into the BOQ — there is nothing to reverse.`,
      );
    }

    // Guard 3 — a billed VO cannot be reversed here: reverse the client invoice/allocation first.
    const allocations = await this.repo.findAllocationsByVariation(prisma, orgId, id);
    if (allocations.length > 0) {
      throw new ConflictException(
        `Variation ${vo.reference} has already been billed — reverse the invoice first.`,
      );
    }

    const projectId = vo.contract.projectId;
    const reversedAt = new Date();

    // The net that raised the current contract value at adopt — the same figure we now subtract.
    const netDelta = vo.lines.reduce(
      (sum, l) => sum.plus(l.amount as Decimal),
      new Decimal(0),
    );

    const result = await prisma.$transaction(async (tx) => {
      // 1. Retract the VO scope from the committed BOQ + cut the fresh reduced snapshot.
      const retracted = await this.boqVersioning.retractVariationNodes(tx, identity, projectId, {
        id: vo.id,
        reference: vo.reference,
      });

      // 2. Lower the current contract value by the VO net (base stays frozen).
      const lowered = await this.contracts.lowerCurrentValueForVariation(tx, identity, vo.contractId, {
        id: vo.id,
        reference: vo.reference,
        netDelta,
      });

      // 3. Clear the applied marker — the VO no longer reads as adopted.
      await this.repo.clearBoqApplied(tx, vo.id);

      // 4. Move the VO to WITHDRAWN (the retracted terminal).
      await this.repo.transition(tx, vo.id, 'WITHDRAWN', { reason: dto.reason ?? undefined });

      // 5. One business audit event for the whole reversal.
      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'VariationOrder',
        resourceId: vo.id,
        sourceCommand: 'variation.reverse',
        eventType: 'VARIATION_ORDER_REVERSED',
        idempotencyKey: `variation-reverse-${vo.id}`,
        before: { status: 'CLIENT_APPROVED', contractValue: lowered.previousContractValue },
        after: {
          status: 'WITHDRAWN',
          boqVersionId: retracted.versionId,
          snapshotVersionId: retracted.snapshotVersionId,
          removedCount: retracted.removedCount,
          netDelta: netDelta.toFixed(2),
          previousContractValue: lowered.previousContractValue,
          newContractValue: lowered.newContractValue,
        },
        reason: dto.reason ?? undefined,
      });

      return { retracted, lowered };
    });

    return {
      variationId: vo.id,
      reference: vo.reference,
      projectId,
      boqVersionId: result.retracted.versionId,
      snapshotVersionId: result.retracted.snapshotVersionId,
      removedCount: result.retracted.removedCount,
      newContractValue: result.lowered.newContractValue,
      reversedAt: reversedAt.toISOString(),
    };
  }
}
