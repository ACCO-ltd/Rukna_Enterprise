import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { RequestIdentity, AdoptBaselineResponse } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { AdoptBaselinePrismaRepository } from '../infrastructure/adopt-baseline-prisma.repository.js';
import {
  ExtensionOfTimePolicy,
  type ContractStatusValue,
} from '../domain/extension-of-time.policy.js';
import type { AdoptBaselineDto } from '../presentation/dto/adopt-baseline.dto.js';

/**
 * ADR-026 CONST-VAR-007 / OQ-2 (Variations Phase 2) — the Contract-Baseline repoint command.
 *
 * OQ-2 is DECIDED (Eng Ahmed 2026-08-28, ceo-memo-variations-followup.md): adopting a new BOQ
 * baseline into the contract is a DELIBERATE, RECORDED, AUDITED act — NEVER automatic on VO approval
 * or on the apply-to-BOQ step. This is the separate explicit command that performs it, and it is what
 * lets certification claims reach the enlarged scope.
 *
 * It:
 *   - resolves tenancy + asserts contract membership (reuses the commercial/contract permission
 *     scheme via the controller decorators);
 *   - guards the target version: must be a BASELINED version belonging to THIS contract's project's
 *     BOQ (an unbaselined draft or a foreign version is rejected);
 *   - guards the contract state: live only (ACTIVE / FINAL_ACCOUNT_PENDING — reuses the EoT policy's
 *     live-contract set); a terminal or not-yet-executed contract cannot be repointed;
 *   - no-ops loudly if the contract already points at that version (nothing to record);
 *   - in ONE transaction: repoints `Contract.boqVersionId` and writes a business audit event
 *     (old→new baseline + actor + reason).
 *
 * It does NOT touch `Contract.contractValue`, the BOQ, or the certify→invoice chain.
 */
@Injectable()
export class AdoptBaselineService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: AdoptBaselinePrismaRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  async adopt(
    identity: RequestIdentity,
    contractId: string,
    dto: AdoptBaselineDto,
  ): Promise<AdoptBaselineResponse> {
    await this.projectAccess.assertContract(identity, contractId);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const contract = await this.repo.findContract(prisma, orgId, contractId);
    if (!contract) throw new NotFoundException(`Contract ${contractId} not found`);

    // Guard the contract state: repointing the baseline that is certified/billed against is only
    // valid on a live contract.
    const status = contract.status as ContractStatusValue;
    if (!ExtensionOfTimePolicy.contractStateAllowsExtension(status)) {
      const detail = ExtensionOfTimePolicy.isTerminal(status)
        ? `contract is terminal ('${status}')`
        : `contract is not yet live ('${status}')`;
      throw new ConflictException(
        `Cannot adopt a new baseline: ${detail}. ` +
          `Only a live contract (ACTIVE or FINAL_ACCOUNT_PENDING) has a movable Contract Baseline.`,
      );
    }

    // Guard the target version: it must be BASELINED and belong to this contract's project's BOQ.
    const version = await this.repo.findVersionWithProject(prisma, dto.boqVersionId);
    if (!version || version.boq.projectId !== contract.projectId) {
      throw new NotFoundException(
        `BOQ version ${dto.boqVersionId} does not belong to this contract's project.`,
      );
    }
    if (version.status !== 'BASELINED') {
      throw new BadRequestException(
        `BOQ version ${dto.boqVersionId} is '${version.status}', not BASELINED. ` +
          `Only a baselined (approved) revision can be adopted as the Contract Baseline.`,
      );
    }

    if (contract.boqVersionId === dto.boqVersionId) {
      throw new ConflictException(
        `This contract already adopts BOQ version ${dto.boqVersionId} as its baseline.`,
      );
    }

    const previousBoqVersionId = contract.boqVersionId;

    await prisma.$transaction(async (tx) => {
      await this.repo.updateContractBaseline(tx, contractId, dto.boqVersionId);
      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'Contract',
        resourceId: contractId,
        sourceCommand: 'contract.adoptBaseline',
        eventType: 'CONTRACT_BASELINE_REPOINTED',
        idempotencyKey: `contract-adopt-baseline-${contractId}-${dto.boqVersionId}`,
        before: { boqVersionId: previousBoqVersionId },
        after: { boqVersionId: dto.boqVersionId },
        reason: dto.reason,
      });
    });

    return {
      contractId,
      previousBoqVersionId,
      boqVersionId: dto.boqVersionId,
      boqVersionNumber: version.versionNumber,
      adoptedBy: identity.userId,
      adoptedAt: new Date().toISOString(),
    };
  }
}
