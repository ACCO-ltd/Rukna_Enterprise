import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ContractPrismaRepository, ContractFull } from '../infrastructure/contract-prisma.repository.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import {
  CommercialTermPolicy,
  type CommercialMutationKind,
} from '../domain/commercial-term-policy.js';
import type { CreateContractDto, PaymentInstallmentDto } from '../presentation/dto/create-contract.dto.js';
import type { UpdateContractDto } from '../presentation/dto/update-contract.dto.js';
import type { AddAdvanceTermDto } from '../presentation/dto/add-advance-term.dto.js';
import type { AddGuaranteeDto } from '../presentation/dto/add-guarantee.dto.js';
import type { UpdateGuaranteeDto } from '../presentation/dto/update-guarantee.dto.js';
import type { AddMilestoneDto } from '../presentation/dto/add-milestone.dto.js';
import type { AddRetentionTermsDto } from '../presentation/dto/add-retention-terms.dto.js';

const CANCEL_ALLOWED_FROM = new Set(['DRAFT', 'UNDER_REVIEW', 'PENDING_SIGNATURE']);

const TRANSITIONS: Record<string, { from: string; to: string }> = {
  submit:           { from: 'DRAFT',                to: 'UNDER_REVIEW' },
  'approve-review': { from: 'UNDER_REVIEW',         to: 'PENDING_SIGNATURE' },
  execute:          { from: 'PENDING_SIGNATURE',     to: 'ACTIVE' },
  close:            { from: 'FINAL_ACCOUNT_PENDING', to: 'CLOSED' },
};

@Injectable()
export class ContractService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: ContractPrismaRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  async findAll(identity: RequestIdentity, projectId?: string) {
    const prisma = this.tenancyService.getClient();
    if (projectId) await this.projectAccess.assertMember(identity, projectId);
    return this.repo.findAll(
      prisma,
      identity.activeOrganizationId,
      projectId,
      this.projectAccess.scopedUserId(identity),
    );
  }

  async findOne(identity: RequestIdentity, id: string): Promise<ContractFull> {
    await this.projectAccess.assertContract(identity, id);
    const prisma = this.tenancyService.getClient();
    const contract = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!contract) throw new NotFoundException(`Contract ${id} not found`);
    return contract;
  }

  async create(identity: RequestIdentity, dto: CreateContractDto) {
    await this.projectAccess.assertMember(identity, dto.projectId);
    const prisma = this.tenancyService.getClient();

    // Validate BOQ version exists for this project and is BASELINED.
    const boqVersion = await prisma.boqVersion.findFirst({
      where: { id: dto.boqVersionId, boq: { projectId: dto.projectId } },
      select: { status: true },
    });
    if (!boqVersion) {
      throw new NotFoundException(
        `BOQ version ${dto.boqVersionId} not found for project ${dto.projectId}`,
      );
    }
    if (boqVersion.status !== 'BASELINED') {
      throw new BadRequestException(
        `A contract can only reference a BASELINED BOQ version. Current status: ${boqVersion.status}`,
      );
    }

    const duplicate = await this.repo.findByNumber(
      prisma,
      identity.activeOrganizationId,
      dto.contractNumber,
    );
    if (duplicate) {
      throw new ConflictException(`Contract number '${dto.contractNumber}' already exists`);
    }

    const contractKind = dto.contractKind ?? 'CLIENT_CONTRACT';

    // ADR-023: a payment schedule belongs only to a MILESTONE (payment-schedule) contract,
    // and must reconcile to 100% before it is written.
    const billingModel = dto.billingModel ?? 'MEASURED_IPC';
    if (dto.paymentPlan && dto.paymentPlan.length > 0) {
      if (billingModel !== 'MILESTONE') {
        throw new BadRequestException(
          'A payment plan applies only to a MILESTONE (payment-schedule) contract.',
        );
      }
      this.assertPaymentPlanReconciles(dto.paymentPlan);
    }

    return prisma.$transaction(async (tx) => {
      // Invariant check inside the transaction so the read and the subsequent
      // insert are atomic. A unique partial DB index is the backstop for races
      // that slip through before the index is added.
      if (contractKind === 'CLIENT_CONTRACT') {
        const existing = await this.repo.findEffectiveClientContract(tx, dto.projectId);
        if (existing) {
          throw new ConflictException(
            `Project already has a current client contract (${existing.contractNumber}). ` +
            `A second CLIENT_CONTRACT can only be created after the existing one is CLOSED, CANCELLED, or TERMINATED.`,
          );
        }
      }

      const contract = await this.repo.create(tx, {
        organizationId: identity.activeOrganizationId,
        projectId: dto.projectId,
        clientId: dto.clientId,
        boqVersionId: dto.boqVersionId,
        contractNumber: dto.contractNumber,
        contractValue: dto.contractValue,
        currency: dto.currency,
        billingModel: dto.billingModel,
        contractKind,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        expectedEndDate: dto.expectedEndDate ? new Date(dto.expectedEndDate) : undefined,
        createdBy: identity.userId,
      });

      if (dto.paymentPlan && dto.paymentPlan.length > 0) {
        await this.repo.createPaymentInstallments(tx, contract.id, dto.paymentPlan);
      }

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'Contract',
        resourceId: contract.id,
        sourceCommand: 'contract.create',
        eventType: 'CONTRACT_CREATED',
        idempotencyKey: `contract-create-${contract.id}`,
        after: {
          projectId: dto.projectId,
          contractNumber: dto.contractNumber,
          status: 'DRAFT',
        },
      });

      return contract;
    });
  }

  /**
   * ADR-023 CONST-COM-012: a payment schedule's percentages must reconcile to 100%.
   * Percentages are fractions (0..1); Σ must equal 1 within a 4-dp tolerance. Each installment
   * must be positive, and a TIME_BASED installment must carry a due offset or an explicit date.
   */
  private assertPaymentPlanReconciles(plan: PaymentInstallmentDto[]): void {
    let sum = 0;
    for (const line of plan) {
      if (!(line.percentage > 0)) {
        throw new BadRequestException(
          `Payment installment "${line.name}" must have a percentage greater than 0.`,
        );
      }
      if (
        line.triggerType === 'TIME_BASED' &&
        line.dueOffsetDays === undefined &&
        line.dueDate === undefined
      ) {
        throw new BadRequestException(
          `Time-based installment "${line.name}" needs a due offset (days) or a due date.`,
        );
      }
      sum += line.percentage;
    }
    // Round to 4 decimals before comparing so float error (0.1 + 0.2 …) does not fail a valid plan.
    if (Math.abs(Math.round(sum * 10000) / 10000 - 1) > 1e-4) {
      throw new BadRequestException(
        `Payment plan percentages must total 100%. Current total: ${(sum * 100).toFixed(2)}%.`,
      );
    }
  }

  async update(identity: RequestIdentity, id: string, dto: UpdateContractDto) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, id);
    this.assertTermMutationAllowed(contract.status, 'CONTRACT_HEADER');

    return prisma.$transaction(async (tx) => {
      const updated = await this.repo.update(tx, id, {
        contractNumber: dto.contractNumber,
        contractValue: dto.contractValue,
        currency: dto.currency,
        billingModel: dto.billingModel,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        expectedEndDate: dto.expectedEndDate ? new Date(dto.expectedEndDate) : undefined,
      });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'Contract',
        resourceId: id,
        sourceCommand: 'contract.update',
        eventType: 'CONTRACT_UPDATED',
        idempotencyKey: `contract-update-${id}-${Date.now()}`,
        before: {
          contractNumber: contract.contractNumber,
          contractValue: contract.contractValue.toString(),
          currency: contract.currency,
          billingModel: contract.billingModel,
        },
        after: {
          contractNumber: dto.contractNumber,
          contractValue: dto.contractValue,
          currency: dto.currency,
          billingModel: dto.billingModel,
        },
      });

      return updated;
    });
  }

  // ─── Lifecycle commands ───────────────────────────────────────────────────────

  async transition(identity: RequestIdentity, id: string, command: string) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, id);
    const fromStatus = contract.status;

    const step = TRANSITIONS[command];
    if (!step) throw new BadRequestException(`Unknown command '${command}'`);

    if (fromStatus !== step.from) {
      throw new BadRequestException(
        `Cannot '${command}' a contract with status '${fromStatus}'. Expected '${step.from}'.`,
      );
    }

    // On execution (PENDING_SIGNATURE → ACTIVE), freeze client snapshots.
    const snapshotData: Record<string, string> = {};
    if (command === 'execute') {
      snapshotData['clientNameSnapshot'] = contract.client.name;
      snapshotData['clientTaxSnapshot'] = contract.client.taxNumber ?? '';
    }

    return prisma.$transaction(async (tx) => {
      const updated = await this.repo.update(tx, id, { status: step.to, ...snapshotData });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'TRANSITION',
        resourceType: 'Contract',
        resourceId: id,
        sourceCommand: `contract.${command}`,
        eventType: `CONTRACT_${command.toUpperCase().replace(/-/g, '_')}`,
        idempotencyKey: `contract-transition-${id}-${fromStatus}-to-${step.to}`,
        before: { status: fromStatus },
        after: { status: step.to },
      });

      return updated;
    });
  }

  async cancel(identity: RequestIdentity, id: string, reason: string) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, id);
    const fromStatus = contract.status;

    if (!CANCEL_ALLOWED_FROM.has(fromStatus)) {
      throw new BadRequestException(
        `Cannot cancel a contract with status '${fromStatus}'. ` +
        `Allowed from: ${[...CANCEL_ALLOWED_FROM].join(', ')}.`,
      );
    }

    return prisma.$transaction(async (tx) => {
      const updated = await this.repo.update(tx, id, { status: 'CANCELLED' });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'CANCEL',
        resourceType: 'Contract',
        resourceId: id,
        sourceCommand: 'contract.cancel',
        eventType: 'CONTRACT_CANCELLED',
        idempotencyKey: `contract-cancel-${id}-${fromStatus}`,
        reason,
        before: { status: fromStatus },
        after: { status: 'CANCELLED' },
      });

      return updated;
    });
  }

  async terminate(identity: RequestIdentity, id: string, reason: string) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, id);
    const fromStatus = contract.status;

    if (fromStatus !== 'ACTIVE') {
      throw new BadRequestException(
        `Cannot terminate a contract with status '${fromStatus}'. Only ACTIVE contracts can be terminated.`,
      );
    }

    return prisma.$transaction(async (tx) => {
      const updated = await this.repo.update(tx, id, { status: 'TERMINATED' });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'TERMINATE',
        resourceType: 'Contract',
        resourceId: id,
        sourceCommand: 'contract.terminate',
        eventType: 'CONTRACT_TERMINATED',
        idempotencyKey: `contract-terminate-${id}-${fromStatus}`,
        reason,
        before: { status: fromStatus },
        after: { status: 'TERMINATED' },
      });

      return updated;
    });
  }

  // ─── Sub-entity management ────────────────────────────────────────────────────

  async setRetentionTerms(identity: RequestIdentity, id: string, dto: AddRetentionTermsDto) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, id);
    this.assertTermMutationAllowed(contract.status, 'RETENTION_TERMS');

    return prisma.$transaction(async (tx) => {
      const before = contract.retentionTerms;
      const result = await this.repo.upsertRetentionTerms(tx, id, {
        retentionRate: dto.retentionRate,
        retentionCap: dto.retentionCap,
        retentionSplitOnPc: dto.retentionSplitOnPc,
        retentionReleasedAt: dto.retentionReleasedAt ? new Date(dto.retentionReleasedAt) : undefined,
      });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: before ? 'UPDATE' : 'CREATE',
        resourceType: 'ContractRetentionTerms',
        resourceId: id,
        sourceCommand: 'contract.setRetentionTerms',
        eventType: 'CONTRACT_RETENTION_TERMS_SET',
        idempotencyKey: `contract-retention-${id}-${Date.now()}`,
        before: before
          ? {
              retentionRate: before.retentionRate.toString(),
              retentionCap: before.retentionCap.toString(),
              retentionSplitOnPC: before.retentionSplitOnPC.toString(),
            }
          : undefined,
        after: {
          retentionRate: dto.retentionRate,
          retentionCap: dto.retentionCap,
          retentionSplitOnPC: dto.retentionSplitOnPc,
        },
      });

      return result;
    });
  }

  async addAdvanceTerm(identity: RequestIdentity, id: string, dto: AddAdvanceTermDto) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, id);
    this.assertTermMutationAllowed(contract.status, 'ADVANCE_TERM');

    return prisma.$transaction(async (tx) => {
      const term = await this.repo.addAdvanceTerm(tx, id, {
        advanceType: dto.advanceType,
        description: dto.description,
        amount: dto.amount,
        percentage: dto.percentage,
        recoveryRate: dto.recoveryRate,
      });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'ContractAdvanceTerm',
        resourceId: term.id,
        sourceCommand: 'contract.addAdvanceTerm',
        eventType: 'CONTRACT_ADVANCE_TERM_ADDED',
        idempotencyKey: `contract-advance-add-${term.id}`,
        after: {
          contractId: id,
          advanceType: dto.advanceType,
          amount: dto.amount,
          percentage: dto.percentage,
          recoveryRate: dto.recoveryRate,
        },
      });

      return term;
    });
  }

  async removeAdvanceTerm(identity: RequestIdentity, contractId: string, termId: string) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, contractId);
    this.assertTermMutationAllowed(contract.status, 'ADVANCE_TERM');

    // CONST-COM-002: verify the term belongs to THIS contract before touching it.
    const term = await this.repo.findAdvanceTermOwned(prisma, contractId, termId);
    if (!term) throw new NotFoundException(`Advance term ${termId} not found on contract ${contractId}`);

    return prisma.$transaction(async (tx) => {
      await this.repo.removeAdvanceTerm(tx, contractId, termId);

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'DELETE',
        resourceType: 'ContractAdvanceTerm',
        resourceId: termId,
        sourceCommand: 'contract.removeAdvanceTerm',
        eventType: 'CONTRACT_ADVANCE_TERM_REMOVED',
        idempotencyKey: `contract-advance-remove-${termId}`,
        before: {
          contractId,
          advanceType: term.advanceType,
          amount: term.amount?.toString() ?? null,
          recoveryRate: term.recoveryRate.toString(),
        },
      });

      return { id: termId, removed: true };
    });
  }

  async addGuarantee(identity: RequestIdentity, id: string, dto: AddGuaranteeDto) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, id);
    this.assertTermMutationAllowed(contract.status, 'GUARANTEE_TERM');

    return prisma.$transaction(async (tx) => {
      const guarantee = await this.repo.addGuarantee(tx, id, {
        guaranteeType: dto.guaranteeType,
        reference: dto.reference,
        amount: dto.amount,
        currency: dto.currency,
        issuer: dto.issuer,
        beneficiary: dto.beneficiary,
        issueDate: new Date(dto.issueDate),
        expiryDate: new Date(dto.expiryDate),
        notes: dto.notes,
      });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'ContractGuarantee',
        resourceId: guarantee.id,
        sourceCommand: 'contract.addGuarantee',
        eventType: 'CONTRACT_GUARANTEE_ADDED',
        idempotencyKey: `contract-guarantee-add-${guarantee.id}`,
        after: {
          contractId: id,
          guaranteeType: dto.guaranteeType,
          reference: dto.reference ?? null,
          amount: dto.amount,
          currency: dto.currency,
          expiryDate: dto.expiryDate,
        },
      });

      return guarantee;
    });
  }

  async updateGuarantee(
    identity: RequestIdentity,
    contractId: string,
    guaranteeId: string,
    dto: UpdateGuaranteeDto,
  ) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, contractId);
    // Guarantee operational status change is the explicit exception to the baseline freeze.
    this.assertTermMutationAllowed(contract.status, 'GUARANTEE_STATUS');

    // CONST-COM-002: verify the guarantee belongs to THIS contract before touching it.
    const before = await this.repo.findGuaranteeOwned(prisma, contractId, guaranteeId);
    if (!before) {
      throw new NotFoundException(`Guarantee ${guaranteeId} not found on contract ${contractId}`);
    }

    return prisma.$transaction(async (tx) => {
      await this.repo.updateGuarantee(tx, contractId, guaranteeId, {
        status: dto.status,
        notes: dto.notes,
      });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'ContractGuarantee',
        resourceId: guaranteeId,
        sourceCommand: 'contract.updateGuarantee',
        eventType: 'CONTRACT_GUARANTEE_UPDATED',
        idempotencyKey: `contract-guarantee-update-${guaranteeId}-${Date.now()}`,
        before: { status: before.status, notes: before.notes ?? null },
        after: { status: dto.status ?? before.status, notes: dto.notes ?? before.notes ?? null },
      });

      return this.repo.findGuaranteeById(tx, guaranteeId);
    });
  }

  async addMilestone(identity: RequestIdentity, id: string, dto: AddMilestoneDto) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, id);
    this.assertTermMutationAllowed(contract.status, 'MILESTONE_TERM');

    return prisma.$transaction(async (tx) => {
      const milestone = await this.repo.addMilestone(tx, id, {
        name: dto.name,
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        sortOrder: dto.sortOrder,
      });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'ContractMilestone',
        resourceId: milestone.id,
        sourceCommand: 'contract.addMilestone',
        eventType: 'CONTRACT_MILESTONE_ADDED',
        idempotencyKey: `contract-milestone-add-${milestone.id}`,
        after: { contractId: id, name: dto.name, dueDate: dto.dueDate ?? null },
      });

      return milestone;
    });
  }

  async completeMilestone(identity: RequestIdentity, contractId: string, milestoneId: string) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, contractId);
    this.assertTermMutationAllowed(contract.status, 'MILESTONE_COMPLETE');

    // CONST-COM-002: verify the milestone belongs to THIS contract before touching it.
    const before = await this.repo.findMilestoneOwned(prisma, contractId, milestoneId);
    if (!before) {
      throw new NotFoundException(`Milestone ${milestoneId} not found on contract ${contractId}`);
    }
    if (before.completedAt) {
      throw new BadRequestException(`Milestone ${milestoneId} is already complete`);
    }

    return prisma.$transaction(async (tx) => {
      await this.repo.completeMilestone(tx, contractId, milestoneId, identity.userId);

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'COMPLETE',
        resourceType: 'ContractMilestone',
        resourceId: milestoneId,
        sourceCommand: 'contract.completeMilestone',
        eventType: 'CONTRACT_MILESTONE_COMPLETED',
        idempotencyKey: `contract-milestone-complete-${milestoneId}`,
        before: { completedAt: null },
        after: { completedAt: new Date().toISOString(), completedBy: identity.userId },
      });

      return this.repo.findMilestoneById(tx, milestoneId);
    });
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────────

  /**
   * CONST-COM-001 / CONST-COM-008 — single gate for every commercial term mutation.
   * Throws ConflictException (409) when the contract's lifecycle forbids the change.
   */
  private assertTermMutationAllowed(
    status: import('@prisma/client').ContractStatus,
    kind: CommercialMutationKind,
  ): void {
    const decision = CommercialTermPolicy.evaluate(status, kind);
    if (!decision.allowed) {
      throw new ConflictException(
        `Commercial mutation '${kind}' is not permitted for a contract in status '${status}' (${decision.reason}).`,
      );
    }
  }

  private async requireContract(
    prisma: ReturnType<TenancyService['getClient']>,
    identity: RequestIdentity,
    id: string,
  ): Promise<ContractFull> {
    await this.projectAccess.assertContract(identity, id);
    const contract = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!contract) throw new NotFoundException(`Contract ${id} not found`);
    return contract;
  }
}
