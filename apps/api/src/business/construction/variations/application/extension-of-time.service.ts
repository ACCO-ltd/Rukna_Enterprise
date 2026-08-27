import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type {
  RequestIdentity,
  ExtensionOfTimeResponse,
  ExtensionOfTimeListResponse,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import {
  ExtensionOfTimePrismaRepository,
  type ExtensionOfTimeWithCitedVos,
} from '../infrastructure/extension-of-time-prisma.repository.js';
import {
  ExtensionOfTimePolicy,
  deriveGrantedDays,
  type ContractStatusValue,
} from '../domain/extension-of-time.policy.js';
import type { GrantExtensionOfTimeDto } from '../presentation/dto/grant-extension-of-time.dto.js';

/**
 * ADR-026 CONST-VAR-009 (Variations Phase 4) — the Extension-of-Time command on the Contract
 * aggregate.
 *
 * Moving the contractual completion date is a DISTINCT, EXPLICIT, human-invoked command. It is NEVER
 * triggered by VariationOrder approval (that is the whole point of CONST-VAR-009): a VO's
 * `proposedTimeImpactDays` is only justification the user reads, and citing a VO here connects it as
 * evidence, never as cause. The command:
 *   - resolves tenancy + asserts contract membership (reuses the commercial/contract permission scheme
 *     via the controller decorators — same as the VO work);
 *   - guards the contract state (live only — ACTIVE / FINAL_ACCOUNT_PENDING; a terminal contract is
 *     rejected);
 *   - validates every cited VO belongs to this contract (integrity);
 *   - in one transaction: captures the previous date, updates `Contract.expectedEndDate` to the
 *     supplied `newEndDate` (accounting-date rule — the supplied date, not `new Date()`), creates the
 *     immutable EoT row, and writes a business audit event (old→new + reason + actor + time).
 *
 * NOTE: this is a guarded command via permission + audit only — there is deliberately NO DOA
 * governance binding (ADR-026 governs only VO internal approval). Governing the EoT through a DOA
 * chain is a possible later refinement if Eng Ahmed requires it.
 */
@Injectable()
export class ExtensionOfTimeService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: ExtensionOfTimePrismaRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  // ─── Read ─────────────────────────────────────────────────────────────────────

  async listForContract(
    identity: RequestIdentity,
    contractId: string,
  ): Promise<ExtensionOfTimeListResponse> {
    await this.projectAccess.assertContract(identity, contractId);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const contract = await this.repo.findContract(prisma, orgId, contractId);
    if (!contract) throw new NotFoundException(`Contract ${contractId} not found`);

    const rows = await this.repo.findByContract(prisma, orgId, contractId);
    return {
      contractId,
      currentEndDate: contract.expectedEndDate
        ? this.toDateString(contract.expectedEndDate)
        : null,
      extensions: rows.map((r) => this.toResponse(r)),
    };
  }

  // ─── Command ──────────────────────────────────────────────────────────────────

  async grant(
    identity: RequestIdentity,
    contractId: string,
    dto: GrantExtensionOfTimeDto,
  ): Promise<ExtensionOfTimeResponse> {
    await this.projectAccess.assertContract(identity, contractId);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const contract = await this.repo.findContract(prisma, orgId, contractId);
    if (!contract) throw new NotFoundException(`Contract ${contractId} not found`);

    // Guard the contract state: an EoT moves a live contractual date. A terminal contract is rejected;
    // a not-yet-executed one has no contractual date to move.
    const status = contract.status as ContractStatusValue;
    if (!ExtensionOfTimePolicy.contractStateAllowsExtension(status)) {
      const detail = ExtensionOfTimePolicy.isTerminal(status)
        ? `contract is terminal ('${status}')`
        : `contract is not yet live ('${status}')`;
      throw new ConflictException(
        `Cannot grant an extension of time: ${detail}. ` +
          `Only a live contract (ACTIVE or FINAL_ACCOUNT_PENDING) has a movable completion date.`,
      );
    }

    // Validate cited VOs belong to THIS contract (integrity). A VO from another contract → 400.
    const requestedVoIds = dto.variationOrderIds ?? [];
    if (requestedVoIds.length > 0) {
      const found = await this.repo.findVariationOrdersForContract(
        prisma,
        orgId,
        contractId,
        requestedVoIds,
      );
      const foundIds = new Set(found.map((v) => v.id));
      const missing = requestedVoIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Cited variation order(s) do not belong to contract ${contractId}: ${missing.join(', ')}.`,
        );
      }
    }

    // Accounting-date rule: newEndDate is the SUPPLIED effective date, not new Date(). grantedAt is
    // the action timestamp (when the command ran).
    const newEndDate = new Date(dto.newEndDate);
    const previousEndDate = contract.expectedEndDate ?? null;
    const grantedDays = deriveGrantedDays(previousEndDate, newEndDate);
    const grantedAt = new Date();

    const created = await prisma.$transaction(async (tx) => {
      // Update the contract's contractual completion date (the effect of the command).
      await this.repo.updateContractEndDate(tx, contractId, newEndDate);

      const row = await this.repo.create(tx, {
        organizationId: orgId,
        contractId,
        previousEndDate,
        newEndDate,
        grantedDays,
        reason: dto.reason,
        grantedBy: identity.userId,
        grantedAt,
        citedVariationOrderIds: requestedVoIds,
      });

      // Business audit event: the completion-date change is significant — old→new + reason + actor.
      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'Contract',
        resourceId: contractId,
        sourceCommand: 'contract.grantExtensionOfTime',
        eventType: 'CONTRACT_EXPECTED_END_DATE_EXTENDED',
        idempotencyKey: `extension-of-time-${row.id}`,
        before: {
          expectedEndDate: previousEndDate ? this.toDateString(previousEndDate) : null,
        },
        after: {
          extensionOfTimeId: row.id,
          expectedEndDate: this.toDateString(newEndDate),
          grantedDays,
          citedVariationOrderIds: requestedVoIds,
        },
        reason: dto.reason,
      });

      return row;
    });

    return this.toResponse(created);
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────────

  /** Render a `@db.Date` value as a bare `YYYY-MM-DD` string (no timezone-shifting time part). */
  private toDateString(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private toResponse(row: ExtensionOfTimeWithCitedVos): ExtensionOfTimeResponse {
    return {
      id: row.id,
      contractId: row.contractId,
      previousEndDate: row.previousEndDate ? this.toDateString(row.previousEndDate) : null,
      newEndDate: this.toDateString(row.newEndDate),
      grantedDays: row.grantedDays,
      reason: row.reason,
      citedVariationOrders: row.citedVariationOrders.map((vo) => ({
        id: vo.id,
        reference: vo.reference,
        status: vo.status,
      })),
      grantedBy: row.grantedBy,
      grantedAt: row.grantedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
