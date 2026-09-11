import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ContractPrismaRepository, ContractFull } from '../infrastructure/contract-prisma.repository.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { BoqVersioningService } from '../../boq/application/boq-versioning.service.js';
import {
  CommercialTermPolicy,
  type CommercialMutationKind,
} from '../domain/commercial-term-policy.js';
import type { CreateContractDto, PaymentInstallmentDto } from '../presentation/dto/create-contract.dto.js';
import type { ReplacePaymentPlanDto } from '../presentation/dto/replace-payment-plan.dto.js';
import type { UpdateContractDto } from '../presentation/dto/update-contract.dto.js';
import type { AddAdvanceTermDto } from '../presentation/dto/add-advance-term.dto.js';
import type { AddGuaranteeDto } from '../presentation/dto/add-guarantee.dto.js';
import type { UpdateGuaranteeDto } from '../presentation/dto/update-guarantee.dto.js';
import type { AddDeliverableDto } from '../presentation/dto/add-deliverable.dto.js';
import type { AddRetentionTermsDto } from '../presentation/dto/add-retention-terms.dto.js';
import type { SetInstallmentMilestoneDto } from '../presentation/dto/set-installment-milestone.dto.js';
import { RecordAttachmentService } from '../../../../platform/files/application/record-attachment.service.js';

const CANCEL_ALLOWED_FROM = new Set(['DRAFT', 'UNDER_REVIEW', 'PENDING_SIGNATURE']);

// ADR-029 §2 — the operational (committed) BOQ version a contract may be signed against. R2 introduced
// COMMITTED as the in-place operational status; BASELINED still exists until the R2 contract-phase
// migration flips it, so both are accepted as a valid "committed" reference. Anything else
// (DRAFT / SNAPSHOT / SUPERSEDED / CANCELLED) is a version a contract must never anchor to.
const COMMITTED_BOQ_STATUSES = new Set(['COMMITTED', 'BASELINED']);

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
    private readonly attachments: RecordAttachmentService,
    // ADR-029 I-1 / T-4 — the BOQ read port. The contract ties out to the priced scope; the tie-out
    // total is computed here via the one shared `inContractBillableTotal` policy, never re-implemented.
    private readonly boqVersioning: BoqVersioningService,
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

  /**
   * ADR-023 CONST-COM-011: link (or unlink) a programme milestone as a milestone installment's
   * billing evidence. A verified link then gates invoice generation for that installment.
   */
  async setInstallmentMilestone(
    identity: RequestIdentity,
    contractId: string,
    installmentId: string,
    dto: SetInstallmentMilestoneDto,
  ) {
    await this.projectAccess.assertContract(identity, contractId);
    const prisma = this.tenancyService.getClient();
    const contract = await this.repo.findById(prisma, identity.activeOrganizationId, contractId);
    if (!contract) throw new NotFoundException(`Contract ${contractId} not found`);
    if (contract.billingModel !== 'MILESTONE') {
      throw new BadRequestException(
        'Only MILESTONE (payment-schedule) contracts have milestone installments.',
      );
    }
    const installment = await this.repo.findInstallmentInContract(prisma, contractId, installmentId);
    if (!installment) {
      throw new NotFoundException(`Installment ${installmentId} not found on this contract`);
    }
    if (dto.programmeMilestoneId) {
      const milestone = await this.repo.findProjectMilestone(
        prisma,
        contract.projectId,
        dto.programmeMilestoneId,
      );
      if (!milestone) {
        throw new BadRequestException("The milestone does not belong to this contract's project.");
      }
    }
    return this.repo.setInstallmentMilestone(prisma, installmentId, dto.programmeMilestoneId ?? null);
  }

  async create(identity: RequestIdentity, dto: CreateContractDto) {
    await this.projectAccess.assertMember(identity, dto.projectId);
    const prisma = this.tenancyService.getClient();

    // Validate the BOQ version exists for this project and is a committed operational version.
    // ADR-029 §2 accepts both COMMITTED (R2 in-place) and BASELINED (pre-migration) — see
    // COMMITTED_BOQ_STATUSES.
    const boqVersion = await prisma.boqVersion.findFirst({
      where: { id: dto.boqVersionId, boq: { projectId: dto.projectId } },
      select: { status: true },
    });
    if (!boqVersion) {
      throw new NotFoundException(
        `BOQ version ${dto.boqVersionId} not found for project ${dto.projectId}`,
      );
    }
    if (!COMMITTED_BOQ_STATUSES.has(boqVersion.status)) {
      throw new BadRequestException(
        `A contract can only reference a committed BOQ version. Current status: ${boqVersion.status}`,
      );
    }

    const contractKind = dto.contractKind ?? 'CLIENT_CONTRACT';

    // ADR-029 T-1/T-4 — tie out to the priced scope. `getInContractTotal` reuses the one shared
    // `inContractBillableTotal` policy (every leaf except SEPARATE_CHARGE), so the contract can never
    // be signed against a different rule than the commit snapshot was frozen under. D3: the contract
    // reads from the BOQ; it can never be set below/away from that total.
    //
    // The tie-out is the CLIENT contract sum (CONST-BOQ-026 / D3: "the client sees only the contract
    // sum"; milestone billing is client-facing). A SUBCONTRACT's value is the subcontractor's price,
    // not the client BOQ total, so it is NOT tied out — it keeps its supplied value, base = current.
    const tieOutTotal =
      contractKind === 'CLIENT_CONTRACT'
        ? await this.deriveTieOutValue(identity, dto)
        : new Prisma.Decimal(dto.contractValue).toFixed(2);

    const duplicate = await this.repo.findByNumber(
      prisma,
      identity.activeOrganizationId,
      dto.contractNumber,
    );
    if (duplicate) {
      throw new ConflictException(`Contract number '${dto.contractNumber}' already exists`);
    }

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
        // ADR-029 T-2/T-3/T-4 — base is frozen from the tie-out at creation and drives the milestone %;
        // current starts equal to base and is what R6 later increments per adopted on-contract variation.
        baseContractValue: tieOutTotal,
        contractValue: tieOutTotal,
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
   * ADR-029 T-1/T-4 — the tie-out value a contract is created with.
   *
   * Reads the in-contract billable total of the referenced (committed) BOQ version through the BOQ
   * read port — the single `inContractBillableTotal` rule, never a second sum. That total becomes the
   * contract's `baseContractValue` (and its initial `contractValue`). If the caller still supplied a
   * `contractValue`, it must EQUAL the total to the money scale (18,2) or the create is rejected with
   * 400 `TIEOUT_MISMATCH` and the delta — the contract can never be set below or away from the priced
   * scope (D3). Returned as a fixed-scale decimal string so it stores verbatim on the paired-currency
   * money columns (CONST-BOQ-014).
   */
  private async deriveTieOutValue(
    identity: RequestIdentity,
    dto: CreateContractDto,
  ): Promise<string> {
    const total = await this.boqVersioning.getInContractTotal(
      identity,
      dto.projectId,
      dto.boqVersionId,
    );
    if (total === null) {
      throw new BadRequestException(
        `BOQ version ${dto.boqVersionId} has no priced in-contract scope to tie the contract value out to.`,
      );
    }
    const tieOut = new Prisma.Decimal(total);

    // A client-supplied value (the DTO still carries one) must match the tie-out to the cent.
    if (dto.contractValue !== undefined && dto.contractValue !== null) {
      const supplied = new Prisma.Decimal(dto.contractValue);
      if (!supplied.equals(tieOut)) {
        throw new BadRequestException({
          message:
            'Contract value must tie out to the in-contract BOQ total. ' +
            'The BOQ is the priced scope; the contract cannot be set below or away from it.',
          code: 'TIEOUT_MISMATCH',
          details: {
            boqVersionId: dto.boqVersionId,
            tieOutTotal: tieOut.toFixed(2),
            suppliedContractValue: supplied.toFixed(2),
            delta: supplied.minus(tieOut).toFixed(2),
          },
        });
      }
    }

    return tieOut.toFixed(2);
  }

  /**
   * ADR-023 / commercial-billing-model §5 P1 (§3.2 G2) + Q-B (Eng Ahmed, confirmed): the payment-plan
   * editor for a MILESTONE contract. Permitted while the contract is DRAFT *or* ACTIVE.
   *
   * The submitted `installments` are the UN-INVOICED portion of the plan:
   *  - On DRAFT nothing is invoiced, so this is the whole schedule — an ordinary full replace.
   *  - On ACTIVE the already-invoiced installments are FROZEN (never changed or removed); the caller
   *    re-profiles only the remaining un-invoiced stages (rename, shift dates, re-split %, add/remove).
   *
   * Invariants (non-negotiable, Q-B): invoiced installments frozen; contract value unchanged (this
   * endpoint accepts no value); frozen invoiced % + submitted un-invoiced % = 100%; the change is
   * audited. Other statuses (UNDER_REVIEW, PENDING_SIGNATURE, FINAL_ACCOUNT_PENDING, CLOSED,
   * CANCELLED, TERMINATED) are rejected — a payment schedule is only editable before signature
   * (DRAFT) or during delivery (ACTIVE); a locked-down or closed contract changes through a Variation.
   *
   * Persistence (one transaction): keep every invoiced installment untouched; delete the current
   * un-invoiced installments; write the submitted set as the new un-invoiced installments. The new
   * rows carry no `programmeMilestoneId` — links are re-established via the existing
   * `PATCH …/installments/:id/milestone` route (invoiced installments keep their links, untouched).
   */
  async replacePaymentPlan(identity: RequestIdentity, id: string, dto: ReplacePaymentPlanDto) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, id);

    if (contract.status !== 'DRAFT' && contract.status !== 'ACTIVE') {
      throw new ConflictException(
        `A contract's payment plan can only be edited while it is DRAFT or ACTIVE (current status: ` +
        `'${contract.status}'). Change a locked-down or closed schedule through a Variation, not by editing it.`,
      );
    }
    if (contract.billingModel !== 'MILESTONE') {
      throw new BadRequestException(
        'A payment plan applies only to a MILESTONE (payment-schedule) contract.',
      );
    }

    // Q-B: already-invoiced installments are the frozen part of the plan. Their % is held fixed and
    // the submitted (un-invoiced) set must make the whole schedule reconcile to 100% again. On DRAFT
    // this list is empty, so the frozen total is 0 and this collapses to today's full-replace rule.
    const invoiced = await this.repo.findInvoicedInstallments(prisma, id);
    const frozenTotal = invoiced.reduce((sum, i) => sum + i.percentage, 0);
    const isReprofile = invoiced.length > 0;

    this.assertPaymentPlanReconciles(dto.installments, frozenTotal);

    return prisma.$transaction(async (tx) => {
      await this.repo.reprofileUninvoicedInstallments(tx, id, dto.installments);

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: isReprofile ? 'REPROFILE' : 'REPLACE',
        resourceType: 'ContractPaymentPlan',
        resourceId: id,
        sourceCommand: 'contract.replacePaymentPlan',
        // Q-B requires the ACTIVE change to be auditable and distinguishable from a DRAFT replace.
        eventType: isReprofile
          ? 'CONTRACT_PAYMENT_PLAN_REPROFILED'
          : 'CONTRACT_PAYMENT_PLAN_REPLACED',
        idempotencyKey: `contract-payment-plan-${isReprofile ? 'reprofile' : 'replace'}-${id}-${Date.now()}`,
        after: {
          contractId: id,
          status: contract.status,
          frozenInvoicedCount: invoiced.length,
          frozenInvoicedPercentage: frozenTotal,
          installmentCount: dto.installments.length,
        },
      });

      return this.repo.findById(tx, identity.activeOrganizationId, id);
    });
  }

  /**
   * ADR-023 CONST-COM-012: a payment schedule's percentages must reconcile to 100%.
   * Percentages are fractions (0..1). `frozenTotal` is the summed % of the already-invoiced
   * installments that are NOT part of `plan` (0 for a DRAFT contract / full replace); the submitted
   * plan plus that frozen total must equal 1 within a 4-dp tolerance. Each submitted installment must
   * be positive, and a TIME_BASED installment must carry a due offset or an explicit date.
   */
  private assertPaymentPlanReconciles(plan: PaymentInstallmentDto[], frozenTotal = 0): void {
    let sum = frozenTotal;
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
      const editable = (frozenTotal * 100).toFixed(2);
      const detail =
        frozenTotal > 0
          ? ` (already-invoiced stages hold ${editable}%, so the editable stages must total ` +
            `${(100 - frozenTotal * 100).toFixed(2)}%).`
          : '.';
      throw new BadRequestException(
        `Payment plan percentages must total 100%. Current total: ${(sum * 100).toFixed(2)}%${detail}`,
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

  /**
   * ADR-029 T-3 / V-2 — raise the CURRENT contract value by an adopted on-contract variation's net.
   *
   * The Contract-side seam the Variations adopt command (R6) calls to move `Contract.contractValue`
   * when a CLIENT_APPROVED VO is appended in place to the committed BOQ. It runs INSIDE the caller's
   * adopt transaction (`tx`) so the value raise commits atomically with the BOQ append, the frozen
   * SNAPSHOT copy, and the VO applied-stamp — there is never a state where the scope was appended but
   * the contract value did not move, or vice versa.
   *
   * `baseContractValue` is NEVER touched here (T-2): the milestone % schedule derives from the frozen
   * base (T-6), so a variation raises only the current value and never re-spreads the schedule. The
   * new current value is `contractValue + netDelta` — additive, so several adopts accumulate. Money is
   * decimal throughout and stored as a fixed-scale string on the paired-currency column (CONST-BOQ-014).
   *
   * Reached through this service (not a cross-module Contract repo) so the module boundary holds:
   * VariationsModule → ContractsModule is acyclic (ContractsModule never imports Variations).
   */
  async raiseCurrentValueForVariation(
    tx: Prisma.TransactionClient,
    identity: RequestIdentity,
    contractId: string,
    variation: { id: string; reference: string; netDelta: Prisma.Decimal },
  ): Promise<{ previousContractValue: string; newContractValue: string; baseContractValue: string | null }> {
    const orgId = identity.activeOrganizationId;
    const contract = await this.repo.findValueForRaise(tx, orgId, contractId);
    if (!contract) throw new NotFoundException(`Contract ${contractId} not found`);

    const previous = new Prisma.Decimal(contract.contractValue.toString());
    const next = previous.plus(variation.netDelta);
    const previousStr = previous.toFixed(2);
    const newStr = next.toFixed(2);

    await this.repo.raiseCurrentContractValue(tx, contractId, newStr);

    await this.auditOutbox.record(tx, {
      organizationId: orgId,
      actorUserId: identity.userId,
      action: 'UPDATE',
      resourceType: 'Contract',
      resourceId: contractId,
      sourceCommand: 'contract.raiseCurrentValueForVariation',
      eventType: 'CONTRACT_VALUE_RAISED_BY_VARIATION',
      idempotencyKey: `contract-value-raise-${contractId}-${variation.id}`,
      before: { contractValue: previousStr },
      after: {
        contractValue: newStr,
        variationId: variation.id,
        variationReference: variation.reference,
        netDelta: variation.netDelta.toFixed(2),
      },
    });

    return {
      previousContractValue: previousStr,
      newContractValue: newStr,
      baseContractValue: contract.baseContractValue ? contract.baseContractValue.toString() : null,
    };
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

    const result = await prisma.$transaction(async (tx) => {
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

    // Phase 7A: execution is the contract's real signature event, so from here its evidence is
    // part of the record. Outside the transaction because the file lifecycle is a second
    // aggregate and the freeze is idempotent — a retry finishes the job, a rollback would not
    // have to undo it.
    if (command === 'execute') {
      await this.attachments.freezeFor('CONTRACT', id, `evidence on executed contract ${id}`);
    }
    return result;
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

    const guarantee = await prisma.$transaction(async (tx) => {
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

    // Phase 7A: a guarantee is CREATED active — there is no draft period and no "accepted"
    // transition to hook, so leaving ACTIVE (discharged, expired, called) is the only real
    // finalisation the aggregate has. Its instrument becomes history at that point. Inventing an
    // earlier transition to make the rule tidier would be a fabricated control.
    if (dto.status && dto.status !== 'ACTIVE' && before.status === 'ACTIVE') {
      await this.attachments.freezeFor(
        'GUARANTEE',
        guaranteeId,
        `instrument on ${dto.status.toLowerCase()} guarantee ${guaranteeId}`,
      );
    }
    return guarantee;
  }

  async addDeliverable(identity: RequestIdentity, id: string, dto: AddDeliverableDto) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, id);
    this.assertTermMutationAllowed(contract.status, 'DELIVERABLE_TERM');

    return prisma.$transaction(async (tx) => {
      const deliverable = await this.repo.addDeliverable(tx, id, {
        name: dto.name,
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        sortOrder: dto.sortOrder,
      });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'ContractDeliverable',
        resourceId: deliverable.id,
        sourceCommand: 'contract.addDeliverable',
        eventType: 'CONTRACT_DELIVERABLE_ADDED',
        idempotencyKey: `contract-deliverable-add-${deliverable.id}`,
        after: { contractId: id, name: dto.name, dueDate: dto.dueDate ?? null },
      });

      return deliverable;
    });
  }

  async completeDeliverable(identity: RequestIdentity, contractId: string, deliverableId: string) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, contractId);
    this.assertTermMutationAllowed(contract.status, 'DELIVERABLE_COMPLETE');

    // CONST-COM-002: verify the deliverable belongs to THIS contract before touching it.
    const before = await this.repo.findDeliverableOwned(prisma, contractId, deliverableId);
    if (!before) {
      throw new NotFoundException(
        `Deliverable ${deliverableId} not found on contract ${contractId}`,
      );
    }
    if (before.completedAt) {
      throw new BadRequestException(`Deliverable ${deliverableId} is already complete`);
    }

    return prisma.$transaction(async (tx) => {
      await this.repo.completeDeliverable(tx, contractId, deliverableId, identity.userId);

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'COMPLETE',
        resourceType: 'ContractDeliverable',
        resourceId: deliverableId,
        sourceCommand: 'contract.completeDeliverable',
        eventType: 'CONTRACT_DELIVERABLE_COMPLETED',
        idempotencyKey: `contract-deliverable-complete-${deliverableId}`,
        before: { completedAt: null },
        after: { completedAt: new Date().toISOString(), completedBy: identity.userId },
      });

      return this.repo.findDeliverableById(tx, deliverableId);
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
