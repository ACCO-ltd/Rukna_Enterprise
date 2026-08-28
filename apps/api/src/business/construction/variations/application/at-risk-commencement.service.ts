import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity, AtRiskCommencementResponse } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { ACCO_ROLES } from '../../../../platform/workflows/seeders/acco-value-bands.js';
import {
  VariationOrderPrismaRepository,
  type VariationOrderWithLines,
} from '../infrastructure/variation-order-prisma.repository.js';
import { AtRiskCommencementPolicy } from '../domain/at-risk-commencement.policy.js';
import type { VariationOrderStatusValue } from '../domain/variation-order.policy.js';
import type { RecordAtRiskCommencementDto } from '../presentation/dto/at-risk-commencement.dto.js';

type AtRiskAuthorisationRow = Awaited<
  ReturnType<VariationOrderPrismaRepository['createAtRiskAuthorisation']>
>;

/**
 * ADR-026 CONST-VAR-011 (Variations Phase 5, Route 7B) — the at-risk commencement command.
 *
 * Records the audited authorisation to start urgent variation work BEFORE the VO is CLIENT_APPROVED.
 * It is NEVER an informal verbal instruction (memo Q7B): the authorisation is this governed, audited
 * record or the work is not sanctioned. The fixed chain (CONST-VAR-011) is Construction Director + CFO
 * jointly, adding the CEO when the exposure exceeds a **config-driven cap** (OQ-1, default USD 25,000).
 *
 * Firewall (CONST-VAR-011 / -005 / -012): this command changes NEITHER `Contract.contractValue` NOR
 * the BOQ NOR the VO's status/lifecycle. It only appends the exposure-acceptance record. Contract value
 * still waits for CLIENT_APPROVED.
 */
@Injectable()
export class AtRiskCommencementService {
  // OQ-1 (provisional): the at-risk exposure cap. Config-driven so Eng Ahmed's final figure is a
  // one-line change (env `VARIATION_AT_RISK_EXPOSURE_CAP_USD`), never a magic literal in the flow.
  private static readonly CAP_CONFIG_KEY = 'VARIATION_AT_RISK_EXPOSURE_CAP_USD';
  private static readonly CAP_DEFAULT = '25000';

  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: VariationOrderPrismaRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly config: ConfigService,
  ) {}

  /** The exposure cap in force (config-driven). Above it the CEO must also sign. */
  private exposureCap(): Decimal {
    const raw =
      this.config.get<string>(AtRiskCommencementService.CAP_CONFIG_KEY) ??
      AtRiskCommencementService.CAP_DEFAULT;
    return new Decimal(raw);
  }

  // ─── Read ─────────────────────────────────────────────────────────────────────

  async listForVariation(
    identity: RequestIdentity,
    variationOrderId: string,
  ): Promise<AtRiskCommencementResponse[]> {
    const prisma = this.tenancy.getClient();
    const vo = await this.requireVo(prisma, identity, variationOrderId);
    const rows = await this.repo.findAtRiskAuthorisations(
      prisma,
      identity.activeOrganizationId,
      variationOrderId,
    );
    return rows.map((r) => this.toResponse(r, vo.reference));
  }

  // ─── Command ──────────────────────────────────────────────────────────────────

  async record(
    identity: RequestIdentity,
    variationOrderId: string,
    dto: RecordAtRiskCommencementDto,
  ): Promise<AtRiskCommencementResponse> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const vo = await this.requireVo(prisma, identity, variationOrderId);

    // Guard: at-risk commencement is meaningful only while the VO is pre-CLIENT_APPROVED and live.
    const status = vo.status as VariationOrderStatusValue;
    if (!AtRiskCommencementPolicy.eligible(status)) {
      throw new BadRequestException(
        `Cannot record at-risk commencement for variation ${vo.reference}: it is '${status}'. ` +
          'At-risk commencement only applies before the VO is client-approved (DRAFT / PENDING_INTERNAL / INTERNAL_APPROVED).',
      );
    }

    // Resolve the contract (currency default + integrity: the VO's contract must be reachable).
    const contract = await this.repo.findContract(prisma, orgId, vo.contractId);
    if (!contract) throw new NotFoundException(`Contract ${vo.contractId} not found`);

    const exposure = new Decimal(dto.exposureAmount);
    const cap = this.exposureCap();
    const { ceoRequired, requiredRoles } = AtRiskCommencementPolicy.requiredSignatories(exposure, cap);

    // CONST-VAR-011 — the CEO step is REQUIRED above the cap and REJECTED at/below it: the record must
    // reflect the real authority that was needed, never over- or under-stated.
    if (ceoRequired && !dto.ceoUserId) {
      throw new BadRequestException(
        `At-risk exposure ${exposure.toFixed(2)} exceeds the cap ${cap.toFixed(2)} — ` +
          'the CEO must also authorise (ceoUserId is required).',
      );
    }
    if (!ceoRequired && dto.ceoUserId) {
      throw new BadRequestException(
        `At-risk exposure ${exposure.toFixed(2)} is within the cap ${cap.toFixed(2)} — ` +
          'the CEO does not authorise below the cap (omit ceoUserId).',
      );
    }

    // The acting caller must actually hold one of the authorising roles of the required chain — the
    // authorisation cannot be recorded by someone outside the CD/CFO(/CEO) authority (no informal path).
    const authorisingRoles: string[] = [
      ACCO_ROLES.CONSTRUCTION_DIRECTOR,
      ACCO_ROLES.CFO,
      ACCO_ROLES.CEO,
    ];
    if (!identity.roles.some((r) => authorisingRoles.includes(r))) {
      throw new ForbiddenException(
        'Only the Construction Director, CFO or CEO may record an at-risk commencement authorisation.',
      );
    }

    const currency = dto.currency ?? contract.currency;
    const authorisedAt = new Date();

    const created = await prisma.$transaction(async (tx) => {
      const row = await this.repo.createAtRiskAuthorisation(tx, {
        organizationId: orgId,
        variationOrderId,
        exposureAmount: exposure,
        currency,
        capAmount: cap,
        ceoRequired,
        constructionDirectorUserId: dto.constructionDirectorUserId,
        cfoUserId: dto.cfoUserId,
        ceoUserId: dto.ceoUserId ?? null,
        reason: dto.reason,
        voStatusAtAuth: status,
        authorisedBy: identity.userId,
        authorisedAt,
      });

      // Audited exposure-acceptance event. Explicitly records that contract value + BOQ are untouched
      // so the audit trail carries the firewall guarantee (CONST-VAR-011 / -005).
      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'AUTHORISE',
        resourceType: 'VariationOrder',
        resourceId: variationOrderId,
        sourceCommand: 'variation.recordAtRiskCommencement',
        eventType: 'VARIATION_ORDER_AT_RISK_COMMENCEMENT_AUTHORISED',
        idempotencyKey: `variation-at-risk-${row.id}`,
        reason: dto.reason,
        after: {
          atRiskAuthorisationId: row.id,
          exposureAmount: exposure.toFixed(2),
          currency,
          capAmount: cap.toFixed(2),
          ceoRequired,
          requiredRoles,
          constructionDirectorUserId: dto.constructionDirectorUserId,
          cfoUserId: dto.cfoUserId,
          ceoUserId: dto.ceoUserId ?? null,
          voStatusAtAuthorisation: status,
          contractValueChanged: false,
          boqChanged: false,
        },
      });

      return row;
    });

    return this.toResponse(created, vo.reference);
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────────

  private async requireVo(
    prisma: ReturnType<TenancyService['getClient']>,
    identity: RequestIdentity,
    id: string,
  ): Promise<VariationOrderWithLines> {
    const vo = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!vo) throw new NotFoundException(`Variation ${id} not found`);
    // Tenancy + membership: the VO's contract must be reachable by this member.
    await this.projectAccess.assertContract(identity, vo.contractId);
    return vo;
  }

  private toResponse(
    row: AtRiskAuthorisationRow,
    variationReference: string,
  ): AtRiskCommencementResponse {
    return {
      id: row.id,
      variationOrderId: row.variationOrderId,
      variationReference,
      exposureAmount: (row.exposureAmount as Decimal).toFixed(2),
      currency: row.currency,
      capAmount: (row.capAmount as Decimal).toFixed(2),
      ceoRequired: row.ceoRequired,
      constructionDirectorUserId: row.constructionDirectorUserId,
      cfoUserId: row.cfoUserId,
      ceoUserId: row.ceoUserId,
      reason: row.reason,
      voStatusAtAuthorisation: row.voStatusAtAuth,
      authorisedBy: row.authorisedBy,
      authorisedAt: row.authorisedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
