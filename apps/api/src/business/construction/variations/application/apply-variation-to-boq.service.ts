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
import { ContractService } from '../../contracts/application/contract.service.js';
import { VariationOrderPrismaRepository } from '../infrastructure/variation-order-prisma.repository.js';

/**
 * ADR-029 V-1/V-2 (CONST-BOQ-032), extends ADR-026 CONST-VAR-007 — adopt a client-approved on-contract
 * VariationOrder into the BOQ and raise the current contract value.
 *
 * The core adopt command under the internal-budget redesign. For a VO in CLIENT_APPROVED it, in ONE
 * transaction:
 *   - resolves tenancy + asserts contract membership (reuses the commercial/contract permission
 *     scheme via the controller decorators);
 *   - guards the VO state: CLIENT_APPROVED only (its figures are frozen — CONST-VAR-010);
 *   - guards idempotency: a VO already applied (boqAppliedAt set) → 409 (never applied twice);
 *   - V-1 — APPENDS the VO's lines IN PLACE on the operational COMMITTED BOQ version (stable ids, no
 *     deep-copy fork), each `sourceType = VARIATION`, `commercialTreatment = IN_CONTRACT`,
 *     `sourceChangeOrderId = <vo id>`. This legitimately raises the in-contract total (the sanctioned
 *     value-raising path the R2 pin allows) and cuts a fresh frozen SNAPSHOT of the enlarged tree;
 *   - V-2 — raises `Contract.contractValue += net(VO)` through the Contract-side seam
 *     (ContractService.raiseCurrentValueForVariation). `baseContractValue` stays frozen (T-2), so the
 *     milestone `%` schedule is untouched (T-6). The net is Σ of the VO's own signed line amounts;
 *   - stamps the VO applied (idempotency marker) and writes a business audit event.
 *
 * All five writes commit together: there is never a state where the scope was appended but the
 * contract value did not move, or the VO was stamped without its snapshot. It NEVER re-spreads the
 * payment schedule and NEVER merges the VO into a milestone figure (V-3 keeps it a separate line).
 */
@Injectable()
export class ApplyVariationToBoqService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: VariationOrderPrismaRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly boqVersioning: BoqVersioningService,
    private readonly contracts: ContractService,
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
          (vo.boqAppliedVersionId ? ` (version ${vo.boqAppliedVersionId}).` : '.'),
      );
    }

    const projectId = vo.contract.projectId;
    const appliedAt = new Date();

    // V-2 — the net billable amount that raises the current contract value: Σ of the VO's own signed
    // line amounts (an omission line is negative), the same figure the BOQ leaves carry verbatim.
    const netDelta = vo.lines.reduce(
      (sum, l) => sum.plus(l.amount as Decimal),
      new Decimal(0),
    );

    const result = await prisma.$transaction(async (tx) => {
      // V-1 — append in place on the operational COMMITTED version + cut the fresh SNAPSHOT.
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

      // V-2 — raise the current contract value through the Contract-side seam (base stays frozen).
      const raised = await this.contracts.raiseCurrentValueForVariation(tx, identity, vo.contractId, {
        id: vo.id,
        reference: vo.reference,
        netDelta,
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
          snapshotVersionId: applied.snapshotVersionId,
          nodeCount: applied.nodeCount,
          sourceType: 'VARIATION',
          netDelta: netDelta.toFixed(2),
          previousContractValue: raised.previousContractValue,
          newContractValue: raised.newContractValue,
        },
      });

      return { applied, raised };
    });

    return {
      variationId: vo.id,
      reference: vo.reference,
      projectId,
      boqVersionId: result.applied.versionId,
      nodeCount: result.applied.nodeCount,
      snapshotVersionId: result.applied.snapshotVersionId,
      newContractValue: result.raised.newContractValue,
      appliedAt: appliedAt.toISOString(),
    };
  }
}
