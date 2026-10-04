import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { WorkflowTransactionType, type RequestIdentity } from '@erp/types';
import { Decimal } from '@prisma/client/runtime/library';
import type { MaterialRequestStatus, MaterialRequestScope, ProcurementLineType } from '@prisma/client';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { loadActorNames } from '../../../../platform/users/application/actor-names.js';
import { canSeeProcurementMoney, moneyOrNull } from '../../shared/procurement-money.js';
import { MaterialRequestRepository } from '../infrastructure/material-request.repository.js';
import { MaterialRepository } from '../../catalogue/infrastructure/material.repository.js';
import { UomRepository } from '../../catalogue/infrastructure/uom.repository.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';
import {
  CommandGovernanceService,
  throwIfGated,
} from '../../../../platform/workflows/application/command-governance.service.js';

export interface CreateMrLineDto {
  lineType: ProcurementLineType;
  materialCode?: string;
  description: string;
  uomCode: string;
  requestedQuantity: number;
  /** ADR-022 CONST-DOA-001: the value approval routing measures against. */
  estimatedUnitPrice?: number;
  boqNodeId?: string;
  spendCategoryId?: string;
  departmentId?: string;
  costCenterId?: string;
  projectCostCategoryId?: string;
  notes?: string;
}

export interface CreateMaterialRequestDto {
  requestScope: MaterialRequestScope;
  projectId?: string;
  /** Ignored — the server stamps the request date (see todayDateOnly). */
  requestedDate?: string;
  requiredByDate?: string;
  title?: string;
  currencyCode?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  description?: string;
  notes?: string;
  lines: CreateMrLineDto[];
}

// Valid transitions from each status
const NEXT_STATUS: Partial<Record<MaterialRequestStatus, MaterialRequestStatus[]>> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['PARTIALLY_ORDERED', 'FULLY_ORDERED', 'CANCELLED', 'CLOSED'],
  PARTIALLY_ORDERED: ['FULLY_ORDERED', 'CLOSED'],
};

@Injectable()
export class MaterialRequestService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: MaterialRequestRepository,
    private readonly materialRepo: MaterialRepository,
    private readonly uomRepo: UomRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly sod: SegregationOfDutiesService,
    private readonly commandGovernance: CommandGovernanceService,
  ) {}

  /**
   * `GET /procurement/material-requests`. Backward compatible: each row is the MR with its lines
   * as before, plus `project`, `requester`, `estimatedTotal` and `moneyVisible`.
   * `requestedFor` = a project id, or 'overhead' for organization-scoped requests; it combines with
   * the older `projectId` / `scope` params (which keep working).
   */
  async findAll(
    identity: RequestIdentity,
    filters?: {
      status?: MaterialRequestStatus;
      projectId?: string;
      scope?: MaterialRequestScope;
      requestedFor?: string;
      search?: string;
    },
  ) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const { requestedFor, search, ...rest } = filters ?? {};
    const effective: {
      status?: MaterialRequestStatus;
      projectId?: string;
      scope?: MaterialRequestScope;
      search?: string;
      searchProjectIds?: string[];
    } = { ...rest };
    if (requestedFor === 'overhead') effective.scope = 'ORGANIZATION';
    else if (requestedFor) effective.projectId = requestedFor;
    if (effective.projectId) await this.projectAccess.assertMember(identity, effective.projectId);
    if (search?.trim()) {
      effective.search = search;
      effective.searchProjectIds = await this.repo.findProjectIdsMatching(prisma, orgId, search.trim());
    }

    const rows = await this.repo.findAll(
      prisma,
      orgId,
      effective,
      await this.projectAccess.accessibleProjectIds(identity),
    );

    const moneyVisible = canSeeProcurementMoney(identity);
    const [name, projects] = await Promise.all([
      loadActorNames(prisma, rows.map((r) => r.requestedBy)),
      this.repo.findProjectLabels(
        prisma,
        orgId,
        [...new Set(rows.map((r) => r.projectId).filter((v): v is string => Boolean(v)))],
      ),
    ]);
    const projectById = new Map<string, { id: string; code: string; name: string }>(
      projects.map((p) => [p.id, p] as const),
    );

    return rows.map((mr) => ({
      ...mr,
      project: mr.projectId ? (projectById.get(mr.projectId) ?? null) : null,
      requester: { id: mr.requestedBy, name: name(mr.requestedBy) },
      estimatedTotal: moneyOrNull(moneyVisible, estimatedTotal(mr.lines)),
      moneyVisible,
    }));
  }

  async findById(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const mr = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!mr) throw new NotFoundException(`Material request ${id} not found`);
    if (mr.projectId) await this.projectAccess.assertMember(identity, mr.projectId);
    return mr;
  }

  async create(identity: RequestIdentity, dto: CreateMaterialRequestDto) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    // Rule MR-001: PROJECT scope requires projectId
    if (dto.requestScope === 'PROJECT' && !dto.projectId) {
      throw new BadRequestException('projectId is required for PROJECT-scoped material requests');
    }
    // Rule MR-002: ORGANIZATION scope must not have projectId
    if (dto.requestScope === 'ORGANIZATION' && dto.projectId) {
      throw new BadRequestException('projectId must be null for ORGANIZATION-scoped material requests');
    }

    // P8: validate that projectId belongs to this org (cross-org prevention)
    if (dto.projectId) {
      await this.projectAccess.assertMember(identity, dto.projectId);
    }

    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('At least one line is required');
    }

    // An estimate with no currency is not a figure anyone can approve against a monetary
    // threshold, and every amount in this schema is paired with one. Refuse the half-specified
    // case rather than storing a number whose unit nobody knows.
    if (dto.lines.some((line) => line.estimatedUnitPrice !== undefined) && !dto.currencyCode) {
      throw new BadRequestException(
        'currencyCode is required when any line carries an estimated unit price',
      );
    }

    // Resolve and validate lines
    const resolvedLines = await Promise.all(
      dto.lines.map(async (line, i) => {
        // Rule CAT-001: MATERIAL type requires materialCode
        if (line.lineType === 'MATERIAL' && !line.materialCode) {
          throw new BadRequestException(`Line ${i + 1}: materialCode is required for MATERIAL type`);
        }

        let materialId: string | undefined;
        let resolvedUomId: string;

        if (line.materialCode) {
          const material = await this.materialRepo.findByCode(prisma, orgId, line.materialCode);
          if (!material) throw new NotFoundException(`Line ${i + 1}: material '${line.materialCode}' not found`);
          if (material.status !== 'ACTIVE') throw new BadRequestException(`Line ${i + 1}: material '${line.materialCode}' is not active`);
          materialId = material.id;
          // Rule UOM-001: MATERIAL lines use Material.baseUnitOfMeasureId
          resolvedUomId = material.baseUnitOfMeasureId;
        } else {
          const uom = await this.uomRepo.findByCode(prisma, orgId, line.uomCode);
          if (!uom) throw new NotFoundException(`Line ${i + 1}: UoM '${line.uomCode}' not found`);
          resolvedUomId = uom.id;
        }

        return {
          lineNumber: i + 1,
          lineType: line.lineType,
          materialId,
          description: line.description,
          unitOfMeasureId: resolvedUomId,
          requestedQuantity: new Decimal(line.requestedQuantity),
          // ADR-022 CONST-DOA-001: the value approval routing is measured against. Absent is
          // a real state — a requirement raised before this field existed carries none — so it
          // stays undefined rather than defaulting to zero, which would route as free.
          estimatedUnitPrice:
            line.estimatedUnitPrice === undefined
              ? undefined
              : new Decimal(line.estimatedUnitPrice),
          boqNodeId: line.boqNodeId,
          spendCategoryId: line.spendCategoryId,
          departmentId: line.departmentId,
          costCenterId: line.costCenterId,
          projectCostCategoryId: line.projectCostCategoryId,
          notes: line.notes,
        };
      }),
    );

    const count = await this.repo.nextMrNumber(prisma, orgId);
    const mrNumber = `MR-${String(count).padStart(5, '0')}`;

    return prisma.$transaction(async (tx) => {
      const mr = await this.repo.create(tx, {
        organizationId: orgId,
        mrNumber,
        requestScope: dto.requestScope,
        projectId: dto.projectId,
        requestedBy: identity.userId,
        // Server-set: the day the request is raised, never a client-supplied date.
        requestedDate: todayDateOnly(),
        requiredByDate: dto.requiredByDate ? new Date(dto.requiredByDate) : undefined,
        title: dto.title,
        currencyCode: dto.currencyCode,
        priority: dto.priority,
        description: dto.description,
        notes: dto.notes,
        lines: resolvedLines,
      });

      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'MaterialRequest',
        resourceId: mr.id,
        sourceCommand: 'mr.create',
        eventType: 'MR_CREATED',
        idempotencyKey: `mr-create-${mr.id}`,
        after: { mrNumber, requestScope: dto.requestScope, projectId: dto.projectId ?? null, status: 'DRAFT' },
      });

      return mr;
    });
  }

  /**
   * DRAFT → SUBMITTED, through the governance seam (ADR-011). The policy registry routes
   * MATERIAL_REQUEST on 'DRAFT:SUBMITTED', so that is the gated transition; the estimated value
   * (sum of requested qty × estimated unit price) selects the amount band (ADR-022 CONST-DOA-001).
   * No active binding → submits directly (backward-compatible). A binding throws 409 with
   * details.approvalInstanceId; once approved, submitting again re-drives and consumes it.
   */
  async submit(identity: RequestIdentity, id: string) {
    const mr = await this.loadForTransition(identity, id, 'SUBMITTED');
    const governance = await this.commandGovernance.evaluateStateTransition(
      identity,
      'MaterialRequest',
      'DRAFT',
      'SUBMITTED',
      mr.id,
      estimatedTotal(mr.lines),
    );
    throwIfGated(governance.gate, 'Material request submission requires workflow approval.');
    return this.writeTransition(identity, mr, 'SUBMITTED', 'mr.submit', {
      approvalInstanceId: governance.consumedApproval?.instanceId,
    });
  }

  /** SUBMITTED → APPROVED by a person holding approve:material-request; never the requester. */
  async approve(identity: RequestIdentity, id: string) {
    return this.transition(identity, id, 'APPROVED', 'mr.approve');
  }

  /**
   * SUBMITTED → DRAFT: the approver sends the request back to the requester with a reason, who
   * can correct and resubmit it. The reason is kept on the audit trail.
   */
  async reject(identity: RequestIdentity, id: string, reason: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required to reject a material request');
    }
    const mr = await this.loadForTransition(identity, id, 'DRAFT');
    if (mr.status !== 'SUBMITTED') {
      throw new ConflictException(`Cannot reject a material request in ${mr.status}`);
    }
    return this.writeTransition(identity, mr, 'DRAFT', 'mr.reject', { reason: reason.trim() });
  }

  async cancel(identity: RequestIdentity, id: string) {
    const updated = await this.transition(identity, id, 'CANCELLED', 'mr.cancel');
    // A cancelled request will never be submitted: close any approval still open for it.
    await this.commandGovernance.voidOpenApproval(WorkflowTransactionType.MATERIAL_REQUEST, id);
    return updated;
  }

  private async loadForTransition(identity: RequestIdentity, id: string, to: MaterialRequestStatus) {
    const prisma = this.tenancy.getClient();
    const mr = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!mr) throw new NotFoundException(`Material request ${id} not found`);
    if (mr.projectId) await this.projectAccess.assertMember(identity, mr.projectId);

    const allowed = NEXT_STATUS[mr.status] ?? [];
    if (!allowed.includes(to)) {
      throw new ConflictException(`Cannot transition MR from ${mr.status} to ${to}`);
    }
    return mr;
  }

  private async transition(
    identity: RequestIdentity,
    id: string,
    to: MaterialRequestStatus,
    sourceCommand: string,
  ) {
    const mr = await this.loadForTransition(identity, id, to);

    // ADR-022 CONST-DOA-003: a requester cannot approve their own material request.
    if (to === 'APPROVED') {
      await this.sod.assertAllowed({
        organizationId: identity.activeOrganizationId,
        action: 'APPROVE_MATERIAL_REQUEST',
        actorUserId: identity.userId,
        requesterUserId: mr.requestedBy,
      });
    }

    return this.writeTransition(identity, mr, to, sourceCommand);
  }

  private async writeTransition(
    identity: RequestIdentity,
    mr: { id: string; status: MaterialRequestStatus },
    to: MaterialRequestStatus,
    sourceCommand: string,
    extra: { approvalInstanceId?: string; reason?: string } = {},
  ) {
    const prisma = this.tenancy.getClient();
    const id = mr.id;
    const fromStatus = mr.status;

    return prisma.$transaction(async (tx) => {
      // Guarded on the status read above, so a concurrent transition cannot be overwritten.
      const updated = await this.repo.updateStatus(tx, id, to, {
        expectedStatus: fromStatus,
        ...(extra.approvalInstanceId ? { approvalInstanceId: extra.approvalInstanceId } : {}),
      });
      if (!updated) {
        throw new ConflictException(
          'The material request changed while this was in progress. Reload and retry.',
        );
      }

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'TRANSITION',
        resourceType: 'MaterialRequest',
        resourceId: id,
        sourceCommand,
        eventType: `MR_${to}`,
        // A request can be returned and resubmitted, so the same from→to pair can recur; the
        // row's new updatedAt makes the key unique per occurrence (and stable for a replay).
        idempotencyKey: `mr-transition-${id}-${fromStatus}-to-${to}-${updated.updatedAt.getTime()}`,
        before: { status: fromStatus },
        after: {
          status: to,
          ...(extra.approvalInstanceId ? { approvalInstanceId: extra.approvalInstanceId } : {}),
          ...(extra.reason ? { reason: extra.reason } : {}),
        },
      });

      return updated;
    });
  }
}

/**
 * The request's estimated value: sum of requested quantity × estimated unit price over the lines
 * that carry an estimate. Null when no line is priced — an unpriced request has no value to band
 * on, which is not the same as a zero-value one (ADR-022 CONST-DOA-001).
 */
export function estimatedTotal(
  lines: Array<{ requestedQuantity: Decimal.Value; estimatedUnitPrice: Decimal.Value | null }>,
): Decimal | null {
  const priced = lines.filter((l) => l.estimatedUnitPrice !== null && l.estimatedUnitPrice !== undefined);
  if (priced.length === 0) return null;
  return priced.reduce(
    (sum, l) =>
      sum.add(new Decimal(l.requestedQuantity).mul(new Decimal(l.estimatedUnitPrice as Decimal.Value))),
    new Decimal(0),
  );
}

/** Today's date (server clock, UTC calendar day) at midnight — the shape a @db.Date column holds. */
export function todayDateOnly(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
