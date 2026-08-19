import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity, IpaPrefillLine } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { CommandGovernanceService, throwIfGated } from '../../../../platform/workflows/application/command-governance.service.js';
import { IpaPrismaRepository } from '../infrastructure/ipa-prisma.repository.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { ProgressService } from '../../progress/application/progress.service.js';
import type { CreateIpaDto } from '../presentation/dto/create-ipa.dto.js';
import type { AddIpaItemDto } from '../presentation/dto/add-ipa-item.dto.js';
import type { AddIpaDeductionDto } from '../presentation/dto/add-ipa-deduction.dto.js';

// Allowed source status(es) for each command
const TRANSITIONS: Record<string, string | string[]> = {
  'submit-for-approval':    ['DRAFT', 'RETURNED_FOR_REVISION'],
  'return-for-revision':    'PENDING_INTERNAL_APPROVAL',
  'approve-for-submission': 'PENDING_INTERNAL_APPROVAL',
  submit:                   'APPROVED_FOR_SUBMISSION',
};
const TRANSITION_TARGETS: Record<string, string> = {
  'submit-for-approval':    'PENDING_INTERNAL_APPROVAL',
  'return-for-revision':    'RETURNED_FOR_REVISION',
  'approve-for-submission': 'APPROVED_FOR_SUBMISSION',
  submit:                   'SUBMITTED',
};

const MUTABLE_STATUSES = new Set(['DRAFT', 'RETURNED_FOR_REVISION']);
const CANCEL_FROM = new Set(['DRAFT', 'RETURNED_FOR_REVISION']);

@Injectable()
export class IpaService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly commandGovernance: CommandGovernanceService,
    private readonly repo: IpaPrismaRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly progress: ProgressService,
  ) {}

  /**
   * ADR-021/023 firewall-safe pre-fill: suggests each BOQ line's claim from **verified physical
   * progress** (approved DPRs). It only *suggests* — the QS creates the IPA items and confirms the
   * numbers; progress never auto-creates a claim (CONST-PROG-015 / PROG-D14). Suggested cumulative
   * claim = verified-to-date, clamped to [previously-certified, BOQ measurable]; period = cumulative
   * minus previously-certified.
   */
  async getPrefill(identity: RequestIdentity, contractId: string) {
    await this.projectAccess.assertContract(identity, contractId);
    const prisma = this.tenancyService.getClient();

    const contract = await prisma.contract.findFirst({
      where: { id: contractId, organizationId: identity.activeOrganizationId },
      select: { id: true, projectId: true },
    });
    if (!contract) throw new NotFoundException(`Contract ${contractId} not found`);

    const progressLines = await this.progress.getProjectProgress(identity, contract.projectId);

    const suggestions: IpaPrefillLine[] = [];
    for (const line of progressLines) {
      const verified = new Decimal(line.verifiedToDate);
      if (verified.lessThanOrEqualTo(0)) continue;

      const measurable = new Decimal(line.measurableQuantity);
      const prev = new Decimal(
        await this.repo.getLastEffectiveCertifiedQty(prisma, contractId, line.boqNodeId),
      );

      // Cumulative claim can't exceed BOQ scope, nor drop below what's already certified.
      let suggestedCumulative = Decimal.min(verified, measurable);
      if (suggestedCumulative.lessThan(prev)) suggestedCumulative = prev;
      const suggestedPeriod = suggestedCumulative.minus(prev);

      suggestions.push({
        boqNodeId: line.boqNodeId,
        code: line.code,
        description: line.description,
        measurableQuantity: line.measurableQuantity,
        verifiedToDate: line.verifiedToDate,
        previousEffectiveCertified: prev.toString(),
        suggestedCumulativeClaim: suggestedCumulative.toString(),
        suggestedPeriodClaim: suggestedPeriod.toString(),
      });
    }

    return { contractId, projectId: contract.projectId, source: 'VERIFIED_PROGRESS', suggestions };
  }

  async findAll(identity: RequestIdentity, contractId?: string, projectId?: string) {
    if (contractId && projectId) {
      throw new BadRequestException('Provide contractId or projectId, not both.');
    }
    const prisma = this.tenancyService.getClient();
    if (contractId) await this.projectAccess.assertContract(identity, contractId);
    if (projectId) await this.projectAccess.assertMember(identity, projectId);
    return this.repo.findAll(
      prisma,
      identity.activeOrganizationId,
      contractId,
      projectId,
      // userId scope only applies to the unscoped (all-projects) list; single-resource
      // assertions above already enforce access when a specific scope is provided.
      contractId || projectId ? undefined : this.projectAccess.scopedUserId(identity),
    );
  }

  async findOne(identity: RequestIdentity, id: string) {
    await this.projectAccess.assertApplication(identity, id);
    const prisma = this.tenancyService.getClient();
    const ipa = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!ipa) throw new NotFoundException(`IPA ${id} not found`);

    const totalPeriodAmount = ipa.items.reduce(
      (sum, i) => sum.plus(new Decimal(i.periodAmount.toString())),
      new Decimal(0),
    );
    const totalDeductions = ipa.deductions.reduce(
      (sum, d) => sum.plus(new Decimal(d.amount.toString())),
      new Decimal(0),
    );

    return {
      ...ipa,
      totalPeriodAmount: totalPeriodAmount.toFixed(2),
      totalDeductions: totalDeductions.toFixed(2),
      netPayable: totalPeriodAmount.minus(totalDeductions).toFixed(2),
    };
  }

  async create(identity: RequestIdentity, dto: CreateIpaDto) {
    await this.projectAccess.assertContract(identity, dto.contractId);
    const prisma = this.tenancyService.getClient();

    return prisma.$transaction(async (tx) => {
      const ipa = await this.repo.create(tx, {
        contractId: dto.contractId,
        organizationId: identity.activeOrganizationId,
        periodFrom: dto.periodFrom ? new Date(dto.periodFrom) : undefined,
        periodTo: dto.periodTo ? new Date(dto.periodTo) : undefined,
        exchangeRateCurrency: dto.exchangeRateCurrency,
        exchangeRateBase: dto.exchangeRateBase,
        exchangeRateValue: dto.exchangeRateValue,
        exchangeRateDate: dto.exchangeRateDate ? new Date(dto.exchangeRateDate) : undefined,
        notes: dto.notes,
        createdBy: identity.userId,
      });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'InterimPaymentApplication',
        resourceId: ipa.id,
        sourceCommand: 'ipa.create',
        eventType: 'IPA_CREATED',
        idempotencyKey: `ipa-create-${ipa.id}`,
        after: { contractId: dto.contractId, status: 'DRAFT' },
      });

      return ipa;
    });
  }

  async transition(identity: RequestIdentity, id: string, command: string) {
    const prisma = this.tenancyService.getClient();
    const ipa = await this.requireIpa(prisma, identity, id);
    const fromStatus = ipa.status;

    const requiredFrom = TRANSITIONS[command];
    const toState = TRANSITION_TARGETS[command];
    if (!requiredFrom) throw new BadRequestException(`Unknown IPA command '${command}'`);

    const allowed = Array.isArray(requiredFrom) ? requiredFrom : [requiredFrom];
    if (!allowed.includes(fromStatus)) {
      throw new BadRequestException(
        `Cannot '${command}' an IPA with status '${fromStatus}'. Expected: ${allowed.join(' or ')}.`,
      );
    }

    // Governance gate applies to all IPA transition commands uniformly.
    throwIfGated(
      await this.commandGovernance.gateStateTransition(
        identity,
        'InterimPaymentApplication',
        fromStatus,
        toState,
        id,
      ),
      `IPA transition '${command}' requires workflow approval.`,
    );

    const extra: Record<string, unknown> = {};

    // Assign application number at APPROVED_FOR_SUBMISSION.
    if (command === 'approve-for-submission' && ipa.applicationNumber === null) {
      const nextNum = await this.repo.getNextApplicationNumber(prisma, ipa.contractId);
      extra['applicationNumber'] = nextNum;
      extra['applicationRef'] = `IPA-${nextNum.toString().padStart(3, '0')}`;
    }

    // Stamp submission timestamp.
    if (command === 'submit') {
      extra['submittedAt'] = new Date();
      extra['submittedBy'] = identity.userId;
    }

    return prisma.$transaction(async (tx) => {
      const updated = await this.repo.update(tx, id, { status: toState, ...extra } as never);

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'TRANSITION',
        resourceType: 'InterimPaymentApplication',
        resourceId: id,
        sourceCommand: `ipa.${command}`,
        eventType: `IPA_${command.toUpperCase().replace(/-/g, '_')}`,
        idempotencyKey: `ipa-transition-${id}-${fromStatus}-to-${toState}`,
        before: { status: fromStatus },
        after: { status: toState },
      });

      return updated;
    });
  }

  async cancel(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const ipa = await this.requireIpa(prisma, identity, id);
    const fromStatus = ipa.status;

    if (!CANCEL_FROM.has(fromStatus)) {
      throw new BadRequestException(
        `Cannot cancel an IPA with status '${fromStatus}'. Allowed from: ${[...CANCEL_FROM].join(', ')}.`,
      );
    }

    return prisma.$transaction(async (tx) => {
      const updated = await this.repo.update(tx, id, { status: 'CANCELLED' });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'CANCEL',
        resourceType: 'InterimPaymentApplication',
        resourceId: id,
        sourceCommand: 'ipa.cancel',
        eventType: 'IPA_CANCELLED',
        idempotencyKey: `ipa-cancel-${id}-${fromStatus}`,
        before: { status: fromStatus },
        after: { status: 'CANCELLED' },
      });

      return updated;
    });
  }

  // ─── Items ────────────────────────────────────────────────────────────────────

  async addItem(identity: RequestIdentity, id: string, dto: AddIpaItemDto) {
    const prisma = this.tenancyService.getClient();
    const ipa = await this.requireIpa(prisma, identity, id);

    if (!MUTABLE_STATUSES.has(ipa.status)) {
      throw new BadRequestException(`Cannot add items to an IPA with status '${ipa.status}'`);
    }

    // Load the BOQ node — read unit rate, currency, and quantity from contract, not from client.
    const boqNode = await prisma.boqNode.findUnique({
      where: { id: dto.boqNodeId },
      select: { measurementMethod: true, unitRate: true, currency: true, quantity: true, versionId: true },
    });
    if (!boqNode) throw new NotFoundException(`BOQ node ${dto.boqNodeId} not found`);
    if (!boqNode.unitRate) {
      throw new BadRequestException(`BOQ node ${dto.boqNodeId} has no unit rate — cannot create an IPA item`);
    }

    // Verify the node belongs to the contract's baselined BOQ version.
    const contract = await prisma.contract.findUnique({
      where: { id: ipa.contractId },
      select: { boqVersionId: true },
    });
    if (!contract || boqNode.versionId !== contract.boqVersionId) {
      throw new BadRequestException(
        `BOQ node ${dto.boqNodeId} does not belong to the contract's BOQ version`,
      );
    }

    // Guard: cumulative claimed must not exceed the contracted quantity.
    if (boqNode.quantity !== null) {
      const cumQty = new Decimal(dto.cumulativeClaimed);
      if (cumQty.greaterThan(new Decimal(boqNode.quantity.toString()))) {
        throw new BadRequestException(
          `cumulativeClaimed (${dto.cumulativeClaimed}) exceeds the contracted BOQ quantity (${boqNode.quantity.toString()})`,
        );
      }
    }

    // Denormalize previousEffectiveCertified from the last effective IPC.
    const prevCertified = await this.repo.getLastEffectiveCertifiedQty(
      prisma,
      ipa.contractId,
      dto.boqNodeId,
    );

    const cumulative = new Decimal(dto.cumulativeClaimed);
    const prev = new Decimal(prevCertified);
    const periodQty = cumulative.sub(prev);
    const periodAmount = periodQty.mul(new Decimal(boqNode.unitRate.toString()));

    return this.repo.addItem(prisma, id, {
      boqNodeId: dto.boqNodeId,
      measurementMethodSnapshot: boqNode.measurementMethod,
      unitRateSnapshot: boqNode.unitRate.toString(),
      currencySnapshot: boqNode.currency ?? 'USD',
      cumulativeClaimed: dto.cumulativeClaimed,
      previousEffectiveCertified: prevCertified.toString(),
      periodQuantity: periodQty.toFixed(3),
      periodAmount: periodAmount.toFixed(2),
    });
  }

  async removeItem(identity: RequestIdentity, ipaId: string, itemId: string) {
    const prisma = this.tenancyService.getClient();
    const ipa = await this.requireIpa(prisma, identity, ipaId);

    if (!MUTABLE_STATUSES.has(ipa.status)) {
      throw new BadRequestException(`Cannot remove items from an IPA with status '${ipa.status}'`);
    }
    return this.repo.removeItem(prisma, itemId);
  }

  // ─── Deductions ───────────────────────────────────────────────────────────────

  async addDeduction(identity: RequestIdentity, id: string, dto: AddIpaDeductionDto) {
    const prisma = this.tenancyService.getClient();
    const ipa = await this.requireIpa(prisma, identity, id);

    if (!MUTABLE_STATUSES.has(ipa.status)) {
      throw new BadRequestException(`Cannot add deductions to an IPA with status '${ipa.status}'`);
    }
    return this.repo.addDeduction(prisma, id, {
      deductionType: dto.deductionType,
      sourceTermId: dto.sourceTermId,
      rate: dto.rate,
      basis: dto.basis,
      amount: dto.amount,
    });
  }

  async removeDeduction(identity: RequestIdentity, ipaId: string, deductionId: string) {
    const prisma = this.tenancyService.getClient();
    const ipa = await this.requireIpa(prisma, identity, ipaId);

    if (!MUTABLE_STATUSES.has(ipa.status)) {
      throw new BadRequestException(`Cannot remove deductions from an IPA with status '${ipa.status}'`);
    }
    return this.repo.removeDeduction(prisma, deductionId);
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────────

  private async requireIpa(
    prisma: ReturnType<TenancyService['getClient']>,
    identity: RequestIdentity,
    id: string,
  ) {
    await this.projectAccess.assertApplication(identity, id);
    const ipa = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!ipa) throw new NotFoundException(`IPA ${id} not found`);
    return ipa;
  }
}
