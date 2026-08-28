import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { Prisma, VariationOrderStatus } from '@prisma/client';
import type {
  RequestIdentity,
  VariationOrderResponse,
  VariationOrderLineResponse,
  VariationOrderListResponse,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import {
  CommandGovernanceService,
  throwIfGated,
} from '../../../../platform/workflows/application/command-governance.service.js';
import {
  VariationOrderPrismaRepository,
  type VariationOrderWithLines,
} from '../infrastructure/variation-order-prisma.repository.js';
import {
  VariationOrderPolicy,
  lineAmount,
  netPrice as computeNetPrice,
  type VariationOrderCommand,
  type VariationOrderStatusValue,
} from '../domain/variation-order.policy.js';
import type { CreateVariationDto } from '../presentation/dto/create-variation.dto.js';
import type { UpdateVariationDto } from '../presentation/dto/update-variation.dto.js';
import type {
  AddVariationLineDto,
  UpdateVariationLineDto,
} from '../presentation/dto/variation-line.dto.js';
import type {
  ClientApproveVariationDto,
  RejectVariationDto,
  WithdrawVariationDto,
} from '../presentation/dto/lifecycle.dto.js';

/**
 * ADR-026 (Variations Phase 1) — the VariationOrder aggregate + guarded-command lifecycle.
 *
 * Every command: resolves tenancy, asserts contract membership (reuses the commercial/contract
 * permission scheme — the controller carries the RBAC decorators), guards the transition through
 * the pure domain policy, then writes the mutation + a business audit event in one transaction.
 * The net price is DERIVED from the lines (CONST-VAR-002); `Contract.contractValue` is never
 * mutated (CONST-VAR-005/006).
 */
@Injectable()
export class VariationOrderService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: VariationOrderPrismaRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly governance: CommandGovernanceService,
  ) {}

  // ─── Reads ──────────────────────────────────────────────────────────────────

  async listForContract(
    identity: RequestIdentity,
    contractId: string,
  ): Promise<VariationOrderListResponse> {
    await this.projectAccess.assertContract(identity, contractId);
    const prisma = this.tenancy.getClient();
    const vos = await this.repo.findByContract(prisma, identity.activeOrganizationId, contractId);
    return {
      contractId,
      variations: vos.map((vo) => {
        const { lines, ...rest } = this.toResponse(vo);
        return { ...rest, lineCount: lines.length };
      }),
    };
  }

  async findOne(identity: RequestIdentity, id: string): Promise<VariationOrderResponse> {
    const prisma = this.tenancy.getClient();
    const vo = await this.requireVo(prisma, identity, id);
    // ADR-026 CONST-VAR-007: how many BOQ nodes carry this VO's provenance (the applied indicator).
    const boqNodeCount = await this.repo.countBoqNodes(prisma, id);
    return this.toResponse(vo, boqNodeCount);
  }

  // ─── Create + line CRUD (DRAFT only) ──────────────────────────────────────────

  async create(
    identity: RequestIdentity,
    contractId: string,
    dto: CreateVariationDto,
  ): Promise<VariationOrderResponse> {
    await this.projectAccess.assertContract(identity, contractId);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const contract = await this.repo.findContract(prisma, orgId, contractId);
    if (!contract) throw new NotFoundException(`Contract ${contractId} not found`);

    const seq = await this.repo.nextReferenceSeq(prisma, contractId);
    const reference = `VO-${String(seq).padStart(3, '0')}`;

    const lines = (dto.lines ?? []).map((l, i) => this.buildLine(l, i));

    const created = await prisma.$transaction(async (tx) => {
      const vo = await this.repo.create(tx, {
        organizationId: orgId,
        contractId,
        reference,
        title: dto.title,
        description: dto.description ?? null,
        proposedTimeImpactDays: dto.proposedTimeImpactDays ?? null,
        createdBy: identity.userId,
        lines,
      });

      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'VariationOrder',
        resourceId: vo.id,
        sourceCommand: 'variation.create',
        eventType: 'VARIATION_ORDER_CREATED',
        idempotencyKey: `variation-create-${vo.id}`,
        after: { contractId, reference, status: 'DRAFT', lineCount: lines.length },
      });

      return vo;
    });

    return this.toResponse(created);
  }

  async updateHeader(
    identity: RequestIdentity,
    id: string,
    dto: UpdateVariationDto,
  ): Promise<VariationOrderResponse> {
    const prisma = this.tenancy.getClient();
    const vo = await this.requireVo(prisma, identity, id);
    this.assertEditable(vo);

    const updated = await prisma.$transaction(async (tx) => {
      await this.repo.updateHeader(tx, id, {
        title: dto.title,
        description: dto.description,
        proposedTimeImpactDays: dto.proposedTimeImpactDays,
      });
      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'VariationOrder',
        resourceId: id,
        sourceCommand: 'variation.updateHeader',
        eventType: 'VARIATION_ORDER_UPDATED',
        idempotencyKey: `variation-update-${id}-${Date.now()}`,
      });
      return this.repo.findById(this.tenancy.getClient(), identity.activeOrganizationId, id);
    });
    return this.toResponse(updated!);
  }

  async addLine(
    identity: RequestIdentity,
    id: string,
    dto: AddVariationLineDto,
  ): Promise<VariationOrderResponse> {
    const prisma = this.tenancy.getClient();
    const vo = await this.requireVo(prisma, identity, id);
    this.assertEditable(vo);

    const line = this.buildLine(dto, dto.sortOrder ?? vo.lines.length);
    await prisma.$transaction(async (tx) => {
      const created = await this.repo.addLine(tx, id, line);
      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'VariationOrder',
        resourceId: id,
        sourceCommand: 'variation.addLine',
        eventType: 'VARIATION_ORDER_LINE_ADDED',
        idempotencyKey: `variation-line-add-${created.id}`,
        after: { lineId: created.id, amount: line.amount.toFixed(2) },
      });
    });
    return this.findOne(identity, id);
  }

  async updateLine(
    identity: RequestIdentity,
    id: string,
    lineId: string,
    dto: UpdateVariationLineDto,
  ): Promise<VariationOrderResponse> {
    const prisma = this.tenancy.getClient();
    const vo = await this.requireVo(prisma, identity, id);
    this.assertEditable(vo);

    const existing = await this.repo.findLineOwned(prisma, id, lineId);
    if (!existing) throw new NotFoundException(`Line ${lineId} not found on variation ${id}`);

    // Recompute the signed amount from the effective quantity × rate (CONST-VAR-002).
    const quantity =
      dto.quantity !== undefined ? new Decimal(dto.quantity) : (existing.quantity as Decimal);
    const unitRate =
      dto.unitRate !== undefined ? new Decimal(dto.unitRate) : (existing.unitRate as Decimal);
    const amount = lineAmount({ quantity, unitRate });

    await prisma.$transaction(async (tx) => {
      await this.repo.updateLine(tx, id, lineId, {
        description: dto.description,
        quantity,
        unitRate,
        amount,
        sortOrder: dto.sortOrder,
      });
      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'VariationOrder',
        resourceId: id,
        sourceCommand: 'variation.updateLine',
        eventType: 'VARIATION_ORDER_LINE_UPDATED',
        idempotencyKey: `variation-line-update-${lineId}-${Date.now()}`,
        after: { lineId, amount: amount.toFixed(2) },
      });
    });
    return this.findOne(identity, id);
  }

  async removeLine(
    identity: RequestIdentity,
    id: string,
    lineId: string,
  ): Promise<VariationOrderResponse> {
    const prisma = this.tenancy.getClient();
    const vo = await this.requireVo(prisma, identity, id);
    this.assertEditable(vo);

    const existing = await this.repo.findLineOwned(prisma, id, lineId);
    if (!existing) throw new NotFoundException(`Line ${lineId} not found on variation ${id}`);

    await prisma.$transaction(async (tx) => {
      await this.repo.removeLine(tx, id, lineId);
      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'DELETE',
        resourceType: 'VariationOrder',
        resourceId: id,
        sourceCommand: 'variation.removeLine',
        eventType: 'VARIATION_ORDER_LINE_REMOVED',
        idempotencyKey: `variation-line-remove-${lineId}`,
        before: { lineId, amount: (existing.amount as Decimal).toFixed(2) },
      });
    });
    return this.findOne(identity, id);
  }

  // ─── Lifecycle commands ───────────────────────────────────────────────────────

  async submit(identity: RequestIdentity, id: string): Promise<VariationOrderResponse> {
    const prisma = this.tenancy.getClient();
    const vo = await this.requireVo(prisma, identity, id);
    const to = this.guard(vo, 'submit');
    const now = new Date();

    return this.applyTransition(identity, id, vo, to, {
      submittedBy: identity.userId,
      submittedAt: now,
    }, 'variation.submit', 'VARIATION_ORDER_SUBMITTED');
  }

  async internalApprove(identity: RequestIdentity, id: string): Promise<VariationOrderResponse> {
    const prisma = this.tenancy.getClient();
    const vo = await this.requireVo(prisma, identity, id);
    const to = this.guard(vo, 'internalApprove');

    // CONST-VAR-010: internal approval is amount-banded on |net price| through the SAME governance
    // gate as PO approval. With no active binding this resolves to null and proceeds unchanged;
    // an active VariationOrder band creates the approval instance and returns 409 with the id.
    const amount = this.netPrice(vo).abs();
    throwIfGated(
      await this.governance.gateStateTransition(
        identity,
        'VariationOrder',
        'PENDING_INTERNAL',
        'INTERNAL_APPROVED',
        id,
        amount,
      ),
      'Variation internal approval requires workflow approval.',
    );

    const now = new Date();
    return this.applyTransition(identity, id, vo, to, {
      internalApprovedBy: identity.userId,
      internalApprovedAt: now,
    }, 'variation.internalApprove', 'VARIATION_ORDER_INTERNAL_APPROVED');
  }

  async clientApprove(
    identity: RequestIdentity,
    id: string,
    dto: ClientApproveVariationDto,
  ): Promise<VariationOrderResponse> {
    const prisma = this.tenancy.getClient();
    const vo = await this.requireVo(prisma, identity, id);
    const to = this.guard(vo, 'clientApprove');

    // TODO(OQ-4): the client-approval evidence contract is provisional. The follow-up memo will
    // finalize what constitutes "client + contractual approval" (a signed VO document? an ADR-014
    // PlatformFile attachment? a bare reference number is enough?) AND whether this transition is
    // itself a governed (gated) command. Until then we require a clientApprovalReference + optional
    // note and record who/when. This is the transition that makes the VO count toward the governing
    // contract value (CONST-VAR-005) and freezes its figures (CONST-VAR-010).
    const now = new Date();
    return this.applyTransition(identity, id, vo, to, {
      clientApprovedBy: identity.userId,
      clientApprovedAt: now,
      clientApprovalReference: dto.clientApprovalReference,
      reason: dto.note ?? undefined,
    }, 'variation.clientApprove', 'VARIATION_ORDER_CLIENT_APPROVED', {
      clientApprovalReference: dto.clientApprovalReference,
    });
  }

  async reject(
    identity: RequestIdentity,
    id: string,
    dto: RejectVariationDto,
  ): Promise<VariationOrderResponse> {
    const prisma = this.tenancy.getClient();
    const vo = await this.requireVo(prisma, identity, id);
    const to = this.guard(vo, 'reject');
    const now = new Date();

    return this.applyTransition(identity, id, vo, to, {
      rejectedBy: identity.userId,
      rejectedAt: now,
      reason: dto.reason,
    }, 'variation.reject', 'VARIATION_ORDER_REJECTED', undefined, dto.reason);
  }

  async withdraw(
    identity: RequestIdentity,
    id: string,
    dto: WithdrawVariationDto,
  ): Promise<VariationOrderResponse> {
    const prisma = this.tenancy.getClient();
    const vo = await this.requireVo(prisma, identity, id);
    const to = this.guard(vo, 'withdraw');

    return this.applyTransition(identity, id, vo, to, {
      reason: dto.reason ?? undefined,
    }, 'variation.withdraw', 'VARIATION_ORDER_WITHDRAWN', undefined, dto.reason);
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────────

  private async applyTransition(
    identity: RequestIdentity,
    id: string,
    vo: VariationOrderWithLines,
    to: VariationOrderStatusValue,
    metadata: Prisma.VariationOrderUpdateInput,
    sourceCommand: string,
    eventType: string,
    after?: Record<string, unknown>,
    reason?: string,
  ): Promise<VariationOrderResponse> {
    const prisma = this.tenancy.getClient();
    await prisma.$transaction(async (tx) => {
      await this.repo.transition(tx, id, to as VariationOrderStatus, metadata);
      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'TRANSITION',
        resourceType: 'VariationOrder',
        resourceId: id,
        sourceCommand,
        eventType,
        idempotencyKey: `variation-transition-${id}-${vo.status}-to-${to}`,
        before: { status: vo.status },
        after: { status: to, ...(after ?? {}) },
        reason,
      });
    });
    return this.findOne(identity, id);
  }

  /** Guard a lifecycle command through the pure policy, throwing 409 when it is illegal. */
  private guard(
    vo: VariationOrderWithLines,
    command: VariationOrderCommand,
  ): VariationOrderStatusValue {
    const decision = VariationOrderPolicy.evaluateTransition(
      vo.status as VariationOrderStatusValue,
      command,
    );
    if (!decision.allowed || !decision.to) {
      throw new ConflictException(
        `Cannot '${command}' variation ${vo.reference} in status '${vo.status}' (${decision.reason}).`,
      );
    }
    return decision.to;
  }

  private assertEditable(vo: VariationOrderWithLines): void {
    if (!VariationOrderPolicy.fieldsEditable(vo.status as VariationOrderStatusValue)) {
      throw new ConflictException(
        `Variation ${vo.reference} is no longer editable in status '${vo.status}' ` +
          `(field editing closes at PENDING_INTERNAL — CONST-VAR-004).`,
      );
    }
  }

  private buildLine(
    l: { description: string; quantity: number; unitRate: number },
    sortOrder: number,
  ) {
    const quantity = new Decimal(l.quantity);
    const unitRate = new Decimal(l.unitRate);
    return {
      description: l.description,
      quantity,
      unitRate,
      amount: lineAmount({ quantity, unitRate }),
      sortOrder,
    };
  }

  private netPrice(vo: VariationOrderWithLines): Decimal {
    return computeNetPrice(vo.lines.map((l) => ({ amount: l.amount as Decimal })));
  }

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

  private toResponse(vo: VariationOrderWithLines, boqNodeCount = 0): VariationOrderResponse {
    const lines: VariationOrderLineResponse[] = vo.lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: (l.quantity as Decimal).toString(),
      unitRate: (l.unitRate as Decimal).toFixed(2),
      amount: (l.amount as Decimal).toFixed(2),
      sortOrder: l.sortOrder,
    }));
    return {
      id: vo.id,
      contractId: vo.contractId,
      reference: vo.reference,
      status: vo.status,
      title: vo.title,
      description: vo.description,
      proposedTimeImpactDays: vo.proposedTimeImpactDays,
      netPrice: this.netPrice(vo).toFixed(2),
      lines,
      createdBy: vo.createdBy,
      submittedBy: vo.submittedBy,
      submittedAt: vo.submittedAt?.toISOString() ?? null,
      internalApprovedBy: vo.internalApprovedBy,
      internalApprovedAt: vo.internalApprovedAt?.toISOString() ?? null,
      clientApprovedBy: vo.clientApprovedBy,
      clientApprovedAt: vo.clientApprovedAt?.toISOString() ?? null,
      clientApprovalReference: vo.clientApprovalReference,
      rejectedBy: vo.rejectedBy,
      rejectedAt: vo.rejectedAt?.toISOString() ?? null,
      reason: vo.reason,
      // ADR-026 CONST-VAR-007: applied-to-BOQ indicator. `appliedToBoq` reads off the marker column
      // (set only by the apply command); `boqNodeCount` is the provenance-node count (0 in list rows).
      appliedToBoq: vo.boqAppliedAt !== null,
      boqNodeCount,
      boqAppliedAt: vo.boqAppliedAt?.toISOString() ?? null,
      boqAppliedVersionId: vo.boqAppliedVersionId ?? null,
      createdAt: vo.createdAt.toISOString(),
      updatedAt: vo.updatedAt.toISOString(),
    };
  }
}
