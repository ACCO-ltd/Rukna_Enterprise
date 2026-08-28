import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity, ApplyVariationToBoqResponse } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { BoqVersioningService } from '../../boq/application/boq-versioning.service.js';
import { VariationOrderPrismaRepository } from '../infrastructure/variation-order-prisma.repository.js';

/**
 * ADR-026 CONST-VAR-007 (Variations Phase 2) — scope a client-approved VariationOrder into the BOQ.
 *
 * The core command. For a VO in CLIENT_APPROVED it materialises its scope into the project's BOQ
 * through the EXISTING revision mechanism (ADR-016 deep-copy + governed baseline) — NOT a parallel
 * scope model (ADR-026 Option A). It:
 *   - resolves tenancy + asserts contract membership (reuses the commercial/contract permission
 *     scheme via the controller decorators);
 *   - guards the VO state: CLIENT_APPROVED only (its figures are frozen — CONST-VAR-010);
 *   - guards idempotency: a VO already applied (boqAppliedAt set) cannot be applied again;
 *   - in ONE transaction: opens/reuses an open DRAFT revision and appends the VO's lines as VARIATION
 *     leaf nodes (sourceType = VARIATION + sourceChangeOrderId = the VO's id; omissions are
 *     signed-negative leaves — Option (a)), stamps the VO applied, and writes a business audit event.
 *
 * It deliberately does NOT baseline the revision, and NEVER repoints the Contract Baseline: the
 * revision follows the normal governed baseline command, and adopting it into the contract is a
 * separate explicit act (OQ-2 — see AdoptBaselineService). The cost↔revenue firewall and
 * baselined-BOQ immutability are preserved: original baseline nodes are never edited; the variation
 * lands on a new revision; `Contract.contractValue` and the certify→invoice chain are untouched.
 */
@Injectable()
export class ApplyVariationToBoqService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: VariationOrderPrismaRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly boqVersioning: BoqVersioningService,
  ) {}

  async apply(
    identity: RequestIdentity,
    variationId: string,
  ): Promise<ApplyVariationToBoqResponse> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const vo = await this.repo.findForApply(prisma, orgId, variationId);
    if (!vo) throw new NotFoundException(`Variation ${variationId} not found`);
    await this.projectAccess.assertContract(identity, vo.contractId);

    // CONST-VAR-007 guard: only a client-approved VO enters the BOQ (its figures are frozen).
    if (vo.status !== 'CLIENT_APPROVED') {
      throw new ConflictException(
        `Cannot apply variation ${vo.reference} to the BOQ in status '${vo.status}'. ` +
          `Only a CLIENT_APPROVED variation may be scoped into the BOQ (CONST-VAR-007).`,
      );
    }

    // Idempotency: a VO applied once cannot be applied again.
    if (vo.boqAppliedAt) {
      throw new ConflictException(
        `Variation ${vo.reference} has already been applied to the BOQ` +
          (vo.boqAppliedVersionId ? ` (revision ${vo.boqAppliedVersionId}).` : '.'),
      );
    }

    const projectId = vo.contract.projectId;
    const appliedAt = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const applied = await this.boqVersioning.appendVariationNodes(tx, identity, projectId, {
        id: vo.id,
        reference: vo.reference,
        lines: vo.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity as Decimal,
          unitRate: l.unitRate as Decimal,
          amount: l.amount as Decimal,
          sortOrder: l.sortOrder,
        })),
      });

      await this.repo.markBoqApplied(tx, vo.id, {
        boqAppliedBy: identity.userId,
        boqAppliedAt: appliedAt,
        boqAppliedVersionId: applied.versionId,
      });

      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'VariationOrder',
        resourceId: vo.id,
        sourceCommand: 'variation.applyToBoq',
        eventType: 'VARIATION_ORDER_APPLIED_TO_BOQ',
        idempotencyKey: `variation-apply-boq-${vo.id}`,
        after: {
          boqVersionId: applied.versionId,
          nodeCount: applied.nodeCount,
          sourceType: 'VARIATION',
        },
      });

      return applied;
    });

    return {
      variationId: vo.id,
      reference: vo.reference,
      projectId,
      boqVersionId: result.versionId,
      nodeCount: result.nodeCount,
      appliedAt: appliedAt.toISOString(),
    };
  }
}
