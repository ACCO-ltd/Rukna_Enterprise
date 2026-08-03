import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { WorkflowTriggerResolverService } from '../../../../platform/workflows/application/workflow-trigger-resolver.service.js';
import { IpaPrismaRepository } from '../infrastructure/ipa-prisma.repository.js';
import type { CreateIpaDto } from '../presentation/dto/create-ipa.dto.js';
import type { AddIpaItemDto } from '../presentation/dto/add-ipa-item.dto.js';
import type { AddIpaDeductionDto } from '../presentation/dto/add-ipa-deduction.dto.js';

// Allowed source status for each command
const TRANSITIONS: Record<string, string> = {
  'submit-for-approval':    'DRAFT',
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
    private readonly triggerResolver: WorkflowTriggerResolverService,
    private readonly repo: IpaPrismaRepository,
  ) {}

  async findAll(identity: RequestIdentity, contractId?: string) {
    const prisma = this.tenancyService.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, contractId);
  }

  async findOne(identity: RequestIdentity, id: string) {
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
    const prisma = this.tenancyService.getClient();
    return this.repo.create(prisma, {
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
  }

  async transition(identity: RequestIdentity, id: string, command: string) {
    const prisma = this.tenancyService.getClient();
    const ipa = await this.requireIpa(prisma, identity.activeOrganizationId, id);

    const requiredFrom = TRANSITIONS[command];
    const toState = TRANSITION_TARGETS[command];
    if (!requiredFrom) throw new BadRequestException(`Unknown IPA command '${command}'`);

    if (ipa.status !== requiredFrom) {
      throw new BadRequestException(
        `Cannot '${command}' an IPA with status '${ipa.status}'. Expected '${requiredFrom}'.`,
      );
    }

    // Enforce WorkflowRequirementPolicy. Resolver throws 422 if REQUIRED and no binding configured.
    // When a binding is found, transition proceeds — approval instance creation is Sprint 4+ work.
    if (command === 'submit-for-approval' || command === 'return-for-revision') {
      await this.triggerResolver.resolveForStateTransition(
        identity.activeOrganizationId,
        'InterimPaymentApplication',
        ipa.status,
        toState,
      );
    }

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

    return this.repo.update(prisma, id, { status: toState, ...extra } as never);
  }

  async cancel(identity: RequestIdentity, id: string) {
    const prisma = this.tenancyService.getClient();
    const ipa = await this.requireIpa(prisma, identity.activeOrganizationId, id);

    if (!CANCEL_FROM.has(ipa.status)) {
      throw new BadRequestException(
        `Cannot cancel an IPA with status '${ipa.status}'. Allowed from: ${[...CANCEL_FROM].join(', ')}.`,
      );
    }
    return this.repo.update(prisma, id, { status: 'CANCELLED' });
  }

  // ─── Items ────────────────────────────────────────────────────────────────────

  async addItem(identity: RequestIdentity, id: string, dto: AddIpaItemDto) {
    const prisma = this.tenancyService.getClient();
    const ipa = await this.requireIpa(prisma, identity.activeOrganizationId, id);

    if (!MUTABLE_STATUSES.has(ipa.status)) {
      throw new BadRequestException(`Cannot add items to an IPA with status '${ipa.status}'`);
    }

    // Look up the measurement method snapshot from the BOQ node.
    const boqNode = await prisma.boqNode.findUnique({
      where: { id: dto.boqNodeId },
      select: { measurementMethod: true },
    });
    if (!boqNode) throw new NotFoundException(`BOQ node ${dto.boqNodeId} not found`);

    // Denormalize previousEffectiveCertified from the last effective IPC.
    const prevCertified = await this.repo.getLastEffectiveCertifiedQty(
      prisma,
      ipa.contractId,
      dto.boqNodeId,
    );

    const cumulative = new Decimal(dto.cumulativeClaimed);
    const prev = new Decimal(prevCertified);
    const periodQty = cumulative.sub(prev);
    const periodAmount = periodQty.mul(new Decimal(dto.unitRateSnapshot));

    return this.repo.addItem(prisma, id, {
      boqNodeId: dto.boqNodeId,
      measurementMethodSnapshot: boqNode.measurementMethod,
      unitRateSnapshot: dto.unitRateSnapshot,
      currencySnapshot: dto.currencySnapshot,
      cumulativeClaimed: dto.cumulativeClaimed,
      previousEffectiveCertified: prevCertified.toString(),
      periodQuantity: periodQty.toFixed(3),
      periodAmount: periodAmount.toFixed(2),
    });
  }

  async removeItem(identity: RequestIdentity, ipaId: string, itemId: string) {
    const prisma = this.tenancyService.getClient();
    const ipa = await this.requireIpa(prisma, identity.activeOrganizationId, ipaId);

    if (!MUTABLE_STATUSES.has(ipa.status)) {
      throw new BadRequestException(`Cannot remove items from an IPA with status '${ipa.status}'`);
    }
    return this.repo.removeItem(prisma, itemId);
  }

  // ─── Deductions ───────────────────────────────────────────────────────────────

  async addDeduction(identity: RequestIdentity, id: string, dto: AddIpaDeductionDto) {
    const prisma = this.tenancyService.getClient();
    const ipa = await this.requireIpa(prisma, identity.activeOrganizationId, id);

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
    const ipa = await this.requireIpa(prisma, identity.activeOrganizationId, ipaId);

    if (!MUTABLE_STATUSES.has(ipa.status)) {
      throw new BadRequestException(`Cannot remove deductions from an IPA with status '${ipa.status}'`);
    }
    return this.repo.removeDeduction(prisma, deductionId);
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────────

  private async requireIpa(
    prisma: ReturnType<TenancyService['getClient']>,
    organizationId: string,
    id: string,
  ) {
    const ipa = await this.repo.findById(prisma, organizationId, id);
    if (!ipa) throw new NotFoundException(`IPA ${id} not found`);
    return ipa;
  }
}
