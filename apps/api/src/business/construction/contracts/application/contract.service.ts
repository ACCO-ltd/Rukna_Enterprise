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
import type { CreateContractDto } from '../presentation/dto/create-contract.dto.js';
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

  async update(identity: RequestIdentity, id: string, dto: UpdateContractDto) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, id);

    if (contract.status !== 'DRAFT') {
      throw new BadRequestException('Contract can only be edited in DRAFT status');
    }

    return this.repo.update(prisma, id, {
      contractNumber: dto.contractNumber,
      contractValue: dto.contractValue,
      currency: dto.currency,
      billingModel: dto.billingModel,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      expectedEndDate: dto.expectedEndDate ? new Date(dto.expectedEndDate) : undefined,
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
    await this.requireContract(prisma, identity, id);
    return this.repo.upsertRetentionTerms(prisma, id, {
      retentionRate: dto.retentionRate,
      retentionCap: dto.retentionCap,
      retentionSplitOnPc: dto.retentionSplitOnPc,
      retentionReleasedAt: dto.retentionReleasedAt ? new Date(dto.retentionReleasedAt) : undefined,
    });
  }

  async addAdvanceTerm(identity: RequestIdentity, id: string, dto: AddAdvanceTermDto) {
    const prisma = this.tenancyService.getClient();
    await this.requireContract(prisma, identity, id);
    return this.repo.addAdvanceTerm(prisma, id, {
      advanceType: dto.advanceType,
      description: dto.description,
      amount: dto.amount,
      percentage: dto.percentage,
      recoveryRate: dto.recoveryRate,
    });
  }

  async removeAdvanceTerm(identity: RequestIdentity, contractId: string, termId: string) {
    const prisma = this.tenancyService.getClient();
    await this.requireContract(prisma, identity, contractId);
    return this.repo.removeAdvanceTerm(prisma, termId);
  }

  async addGuarantee(identity: RequestIdentity, id: string, dto: AddGuaranteeDto) {
    const prisma = this.tenancyService.getClient();
    await this.requireContract(prisma, identity, id);
    return this.repo.addGuarantee(prisma, id, {
      guaranteeType: dto.guaranteeType,
      amount: dto.amount,
      currency: dto.currency,
      issuer: dto.issuer,
      beneficiary: dto.beneficiary,
      issueDate: new Date(dto.issueDate),
      expiryDate: new Date(dto.expiryDate),
      notes: dto.notes,
    });
  }

  async updateGuarantee(
    identity: RequestIdentity,
    contractId: string,
    guaranteeId: string,
    dto: UpdateGuaranteeDto,
  ) {
    const prisma = this.tenancyService.getClient();
    await this.requireContract(prisma, identity, contractId);
    return this.repo.updateGuarantee(prisma, guaranteeId, {
      status: dto.status,
      notes: dto.notes,
    });
  }

  async addMilestone(identity: RequestIdentity, id: string, dto: AddMilestoneDto) {
    const prisma = this.tenancyService.getClient();
    await this.requireContract(prisma, identity, id);
    return this.repo.addMilestone(prisma, id, {
      name: dto.name,
      description: dto.description,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      sortOrder: dto.sortOrder,
    });
  }

  async completeMilestone(identity: RequestIdentity, contractId: string, milestoneId: string) {
    const prisma = this.tenancyService.getClient();
    await this.requireContract(prisma, identity, contractId);
    return this.repo.completeMilestone(prisma, milestoneId, identity.userId);
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────────

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
