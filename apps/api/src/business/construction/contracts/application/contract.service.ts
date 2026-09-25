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
import type { RecordSignedContractDto } from '../presentation/dto/record-signed-contract.dto.js';
import { RecordAttachmentService } from '../../../../platform/files/application/record-attachment.service.js';

// A contract is created in DRAFT and only leaves it by going live (activate) — so the sole
// pre-live state a cancel can act on is DRAFT. UNDER_REVIEW/PENDING_SIGNATURE are retired stages
// (ACCO signs on paper; see the lifecycle note on TRANSITIONS) and no longer reachable.
const CANCEL_ALLOWED_FROM = new Set(['DRAFT']);

// ADR-029 §2 — the operational (committed) BOQ version a contract may be signed against. R2 introduced
// COMMITTED as the in-place operational status; BASELINED still exists until the R2 contract-phase
// migration flips it, so both are accepted as a valid "committed" reference. Anything else
// (DRAFT / SNAPSHOT / SUPERSEDED / CANCELLED) is a version a contract must never anchor to.
const COMMITTED_BOQ_STATUSES = new Set(['COMMITTED', 'BASELINED']);

// ACCO prepares and signs its contracts physically, outside the system, so the in-app signing
// dance (submit → review → sign) modelled no real ACCO step — it was pure friction and was never
// gated by the approval engine. The lifecycle collapses to one forward command, `activate`, which
// takes a physically-signed DRAFT straight to ACTIVE and is the single freeze point (client
// identity + evidence). `reopen` (ACTIVE → DRAFT) is its reverse, handled in its own method below
// because it carries an undo. UNDER_REVIEW/PENDING_SIGNATURE remain as dormant enum values (a
// data migration sweeps any lingering rows to DRAFT) but are no longer reachable.
const TRANSITIONS: Record<string, { from: string; to: string }> = {
  activate: { from: 'DRAFT',                 to: 'ACTIVE' },
  close:    { from: 'FINAL_ACCOUNT_PENDING', to: 'CLOSED' },
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

  /**
   * Resolve the project-level client contract used by the BOQ extra-work flow.
   *
   * The browser owns the project context, not database identifiers. Returning anything other than
   * exactly one ACTIVE client contract is therefore a guarded business failure rather than a
   * reason to expose a UUID field to the operator.
   */
  async resolveActiveClientContract(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<{ id: string; contractNumber: string }> {
    await this.projectAccess.assertMember(identity, projectId);
    const contracts = await this.repo.findActiveClientContracts(
      this.tenancyService.getClient(),
      identity.activeOrganizationId,
      projectId,
    );
    if (contracts.length === 0) {
      throw new BadRequestException(
        'Record and activate the main contract before raising a variation.',
      );
    }
    if (contracts.length > 1) {
      throw new ConflictException(
        'This project has more than one active client contract. Resolve the contract configuration before raising a variation.',
      );
    }
    return contracts[0]!;
  }

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

    const contractKind = dto.contractKind ?? 'CLIENT_CONTRACT';

    // Slice-1A / ADR-030 CONST-COM-020 / S-CC-1 — resolve the BOQ version the contract binds to.
    // For a CLIENT_CONTRACT the server finds the current operational version (DRAFT or COMMITTED)
    // and will cut a signing SNAPSHOT inside the transaction. For a SUBCONTRACT the caller supplies
    // an explicit committed version id.
    const { boqId, operationalVersionId } = await this.resolveBoqVersionId(
      identity,
      prisma,
      dto,
      contractKind,
    );

    // ADR-029 T-1/T-4 — tie out to the priced scope. `getInContractTotal` reuses the one shared
    // `inContractBillableTotal` policy (every leaf except SEPARATE_CHARGE), so the contract can never
    // be signed against a different rule than the snapshot was frozen under. D3: the contract
    // reads from the BOQ; it can never be set below/away from that total.
    //
    // CONST-COM-021: the tie-out is the CLIENT contract sum and is READ-ONLY — a supplied value is
    // validated (TIEOUT_MISMATCH) but never required and never overrides. A SUBCONTRACT's value is the
    // subcontractor's price, not the client BOQ total, so it is NOT tied out — it keeps its supplied
    // value (still required for a SUBCONTRACT), base = current.
    let tieOutTotal: string;
    if (contractKind === 'CLIENT_CONTRACT') {
      tieOutTotal = await this.deriveTieOutValue(identity, dto, operationalVersionId);
    } else {
      if (dto.contractValue === undefined || dto.contractValue === null) {
        throw new BadRequestException('A SUBCONTRACT requires an explicit contract value.');
      }
      tieOutTotal = new Prisma.Decimal(dto.contractValue).toFixed(2);
    }

    // CONST-COM-022 / S-CC-3 — the contract number is system-generated when omitted (the minimal
    // form path). When the caller supplies one (the old form), the existing duplicate guard still
    // applies before we open the transaction.
    if (dto.contractNumber) {
      const duplicate = await this.repo.findByNumber(
        prisma,
        identity.activeOrganizationId,
        dto.contractNumber,
      );
      if (duplicate) {
        throw new ConflictException(`Contract number '${dto.contractNumber}' already exists`);
      }
    }

    // ADR-023: a payment schedule belongs only to a MILESTONE (payment-schedule) contract,
    // and must reconcile to 100% before it is written. S-CC-4: MILESTONE is the default when omitted.
    const billingModel = dto.billingModel ?? 'MILESTONE';
    if (dto.paymentPlan && dto.paymentPlan.length > 0) {
      if (billingModel !== 'MILESTONE') {
        throw new BadRequestException(
          'A payment plan applies only to a MILESTONE (payment-schedule) contract.',
        );
      }
      this.assertPaymentPlanReconciles(dto.paymentPlan);
    }

    // When the number is auto-generated it is minted from the project code inside the transaction
    // (below). Read the code up-front (org-scoped) so a missing project fails before we open the tx.
    let projectCode: string | undefined;
    if (!dto.contractNumber) {
      const project = await this.repo.findProjectCode(
        prisma,
        identity.activeOrganizationId,
        dto.projectId,
      );
      if (!project) {
        throw new NotFoundException(`Project ${dto.projectId} not found`);
      }
      projectCode = project.code;
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

      // Slice-1A — for CLIENT_CONTRACT, cut an immutable signing SNAPSHOT from the operational
      // version inside the transaction so snapshot creation and contract row are atomic. The
      // SUBCONTRACT path anchors directly to the supplied committed version (no snapshot needed).
      const contractBoqVersionId =
        contractKind === 'CLIENT_CONTRACT'
          ? await this.boqVersioning.createContractSigningSnapshot(
              tx as never,
              boqId,
              operationalVersionId,
              identity.userId,
            )
          : operationalVersionId;

      // CONST-COM-022 — mint `{projectCode}-C{n}` from the atomic per-project sequence inside the
      // transaction, exactly like ADR-025 project codes. The increment is atomic, so concurrent
      // creates get distinct numbers; the unique index is the final backstop.
      const contractNumber = dto.contractNumber
        ? dto.contractNumber
        : await this.repo.nextContractNumber(tx, dto.projectId, projectCode!);

      const contract = await this.repo.create(tx, {
        organizationId: identity.activeOrganizationId,
        projectId: dto.projectId,
        clientId: dto.clientId,
        boqVersionId: contractBoqVersionId,
        contractNumber,
        // ADR-029 T-2/T-3/T-4 — base is frozen from the tie-out at creation and drives the milestone %;
        // current starts equal to base and is what R6 later increments per adopted on-contract variation.
        baseContractValue: tieOutTotal,
        contractValue: tieOutTotal,
        currency: dto.currency,
        billingModel,
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
          contractNumber,
          status: 'DRAFT',
        },
      });

      return contract;
    });
  }

  /** Record ACCO's physically signed main contract and make it effective immediately. */
  async recordSigned(identity: RequestIdentity, dto: RecordSignedContractDto) {
    await this.projectAccess.assertMember(identity, dto.projectId);
    if ((dto.billingModel ?? 'MILESTONE') === 'MILESTONE') {
      this.assertPaymentPlanReconciles(dto.paymentPlan);
    }

    const prisma = this.tenancyService.getClient();
    const current = await this.repo.findCurrentOperationalBoqVersion(prisma, dto.projectId);
    if (!current) {
      throw new NotFoundException(
        'No BOQ found for this project. Create the live BOQ before recording the signed contract.',
      );
    }
    const readiness = await this.boqVersioning.getReadiness(
      identity,
      dto.projectId,
      current.operationalVersionId,
    );
    if (!readiness.ready) {
      throw new BadRequestException({
        message: 'Complete the highlighted BOQ items before recording the signed contract.',
        details: { blockers: readiness.blockers },
      });
    }
    const project = await this.repo.findProjectCode(
      prisma,
      identity.activeOrganizationId,
      dto.projectId,
    );
    if (!project) throw new NotFoundException(`Project ${dto.projectId} not found`);

    const boq = await prisma.boq.findFirst({
      where: { id: current.boqId, organizationId: identity.activeOrganizationId },
      select: { currency: true },
    });
    if (!boq) throw new NotFoundException(`BOQ for project ${dto.projectId} not found`);

    const contract = await prisma.$transaction(async (tx) => {
      const existing = await this.repo.findEffectiveClientContract(tx, dto.projectId);
      if (existing) {
        throw new ConflictException(
          `Project already has a current client contract (${existing.contractNumber}).`,
        );
      }
      const client = await tx.client.findFirst({
        where: { id: dto.clientId, organizationId: identity.activeOrganizationId },
        select: { name: true, taxNumber: true },
      });
      if (!client) throw new NotFoundException(`Client ${dto.clientId} not found`);

      const snapshotId = await this.boqVersioning.createContractSigningSnapshot(
        tx as never,
        current.boqId,
        current.operationalVersionId,
        identity.userId,
      );
      const contractNumber = dto.contractNumber
        ? dto.contractNumber
        : await this.repo.nextContractNumber(tx, dto.projectId, project.code);
      const signedValue = new Prisma.Decimal(dto.contractValue).toFixed(2);
      const created = await this.repo.create(tx, {
        organizationId: identity.activeOrganizationId,
        projectId: dto.projectId,
        clientId: dto.clientId,
        boqVersionId: snapshotId,
        contractNumber,
        baseContractValue: signedValue,
        contractValue: signedValue,
        currency: boq.currency,
        billingModel: dto.billingModel ?? 'MILESTONE',
        contractKind: 'CLIENT_CONTRACT',
        startDate: new Date(dto.startDate ?? dto.signedDate),
        expectedEndDate: dto.expectedEndDate ? new Date(dto.expectedEndDate) : undefined,
        signedDate: new Date(dto.signedDate),
        paymentTerms: dto.paymentTerms,
        status: 'ACTIVE',
        clientNameSnapshot: client.name,
        clientTaxSnapshot: client.taxNumber ?? '',
        createdBy: identity.userId,
      });
      if (dto.paymentPlan.length > 0) {
        await this.repo.createPaymentInstallments(tx, created.id, dto.paymentPlan);
      }
      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'Contract',
        resourceId: created.id,
        sourceCommand: 'contract.record-signed',
        eventType: 'CONTRACT_RECORDED_ACTIVE',
        idempotencyKey: `contract-record-signed-${created.id}`,
        after: { projectId: dto.projectId, contractNumber, status: 'ACTIVE' },
      });
      return created;
    });

    if (dto.signedDocumentId) {
      await this.attachments.attach(identity, 'CONTRACT', contract.id, {
        platformFileId: dto.signedDocumentId,
      });
    }
    await this.attachments.freezeFor(
      'CONTRACT',
      contract.id,
      `evidence on activated contract ${contract.id}`,
    );
    const full = await this.repo.findById(
      prisma,
      identity.activeOrganizationId,
      contract.id,
    );
    return {
      contract: full ?? contract,
      originalContractValue: contract.baseContractValue?.toFixed(2) ?? dto.contractValue,
      currentContractValue: contract.contractValue.toFixed(2),
      sourceSnapshotMetadata: { description: 'Signed BOQ snapshot' },
      milestones: full?.paymentInstallments ?? [],
    };
  }

  /**
   * Slice-1A / ADR-030 CONST-COM-020 / S-CC-1..2 — resolve the BOQ version a contract binds to,
   * returning the boqId and operationalVersionId the snapshot will be cut from.
   *
   * CLIENT_CONTRACT: finds the current operational version (DRAFT or COMMITTED) via the BOQ's
   * `currentVersionId` pointer. No committed BOQ is required — the contract signing event itself
   * creates an immutable SNAPSHOT inside the transaction. If no BOQ exists for the project at all,
   * the create is rejected with NotFoundException.
   *
   * SUBCONTRACT: unchanged — an explicit `boqVersionId` is required and must be a committed
   * operational version (COMMITTED_BOQ_STATUSES), verified for this project.
   */
  private async resolveBoqVersionId(
    identity: RequestIdentity,
    prisma: ReturnType<TenancyService['getClient']>,
    dto: CreateContractDto,
    contractKind: import('@prisma/client').ContractKind,
  ): Promise<{ boqId: string; operationalVersionId: string }> {
    if (contractKind === 'CLIENT_CONTRACT') {
      const current = await this.repo.findCurrentOperationalBoqVersion(prisma, dto.projectId);
      if (!current) {
        throw new NotFoundException(
          'No BOQ found for this project. Initialize a BOQ before recording a contract.',
        );
      }
      if (dto.boqVersionId && dto.boqVersionId !== current.operationalVersionId) {
        throw new BadRequestException({
          message:
            'A client contract binds to the current operational BOQ, resolved by the server. ' +
            'The supplied BOQ version does not match the current operational version.',
          code: 'BOQ_VERSION_MISMATCH',
          details: { supplied: dto.boqVersionId, current: current.operationalVersionId },
        });
      }
      return current;
    }

    // SUBCONTRACT — an explicit committed version is required.
    if (!dto.boqVersionId) {
      throw new BadRequestException('A SUBCONTRACT requires an explicit BOQ version.');
    }
    const boqVersion = await prisma.boqVersion.findFirst({
      where: { id: dto.boqVersionId, boq: { projectId: dto.projectId } },
      select: { status: true, boqId: true },
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
    return { boqId: boqVersion.boqId, operationalVersionId: dto.boqVersionId };
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
    boqVersionId: string,
  ): Promise<string> {
    const total = await this.boqVersioning.getInContractTotal(
      identity,
      dto.projectId,
      boqVersionId,
    );
    if (total === null) {
      throw new BadRequestException(
        `BOQ version ${boqVersionId} has no priced in-contract scope to tie the contract value out to.`,
      );
    }
    const tieOut = new Prisma.Decimal(total);

    // CONST-COM-021: the value is derived-only and never required. If the caller still supplied one
    // (the old form), it must match the tie-out to the cent — validated, never overridden silently.
    if (dto.contractValue !== undefined && dto.contractValue !== null) {
      const supplied = new Prisma.Decimal(dto.contractValue);
      if (!supplied.equals(tieOut)) {
        throw new BadRequestException({
          message:
            'Contract value must tie out to the in-contract BOQ total. ' +
            'The BOQ is the priced scope; the contract cannot be set below or away from it.',
          code: 'TIEOUT_MISMATCH',
          details: {
            boqVersionId,
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
   * Back-fill the date the paper contract was physically signed, for a contract that went
   * DRAFT → ACTIVE through `transition('activate')` rather than `recordSigned` (which captures
   * signedDate up front). ACCO signs on paper and there is no in-app review/signature step, so
   * activation never required this fact — it is recorded after the fact as an operational
   * exception to the baseline freeze, not a commercial-term edit.
   */
  async recordSignedDate(identity: RequestIdentity, id: string, signedDate: string) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, id);
    this.assertTermMutationAllowed(contract.status, 'SIGNED_DATE');

    return prisma.$transaction(async (tx) => {
      const updated = await this.repo.update(tx, id, {
        signedDate: new Date(signedDate),
      });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'Contract',
        resourceId: id,
        sourceCommand: 'contract.recordSignedDate',
        eventType: 'CONTRACT_SIGNED_DATE_RECORDED',
        idempotencyKey: `contract-signed-date-${id}-${Date.now()}`,
        before: {
          signedDate: contract.signedDate ? contract.signedDate.toISOString() : null,
        },
        after: { signedDate },
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
      baseContractValue: contract.baseContractValue ? contract.baseContractValue.toFixed(2) : null,
    };
  }

  /**
   * variation-collapse — the INVERSE of `raiseCurrentValueForVariation`: LOWER the current
   * `contractValue` by a reversed (un-adopted) variation's net.
   *
   * The Contract-side seam the Variations reverse command calls when a CLIENT_APPROVED, adopted,
   * UNBILLED VO is un-adopted. It runs INSIDE the caller's reverse transaction (`tx`) so the value
   * lower commits atomically with the BOQ node deletion, the fresh reduced SNAPSHOT, the cleared
   * applied-marker, and the WITHDRAWN transition — there is never a state where the scope was retracted
   * but the contract value did not move, or vice versa.
   *
   * `baseContractValue` is NEVER touched here (mirrors the raise — T-2): the milestone % schedule
   * derives from the frozen base, so a reversal lowers only the current value. The new current value is
   * `contractValue − netDelta`; reusing the ABSOLUTE setter (`raiseCurrentContractValue`) so the raise
   * and lower share one write path.
   */
  async lowerCurrentValueForVariation(
    tx: Prisma.TransactionClient,
    identity: RequestIdentity,
    contractId: string,
    variation: { id: string; reference: string; netDelta: Prisma.Decimal },
  ): Promise<{ previousContractValue: string; newContractValue: string; baseContractValue: string | null }> {
    const orgId = identity.activeOrganizationId;
    const contract = await this.repo.findValueForRaise(tx, orgId, contractId);
    if (!contract) throw new NotFoundException(`Contract ${contractId} not found`);

    const previous = new Prisma.Decimal(contract.contractValue.toString());
    const next = previous.minus(variation.netDelta);
    const previousStr = previous.toFixed(2);
    const newStr = next.toFixed(2);

    await this.repo.raiseCurrentContractValue(tx, contractId, newStr);

    await this.auditOutbox.record(tx, {
      organizationId: orgId,
      actorUserId: identity.userId,
      action: 'UPDATE',
      resourceType: 'Contract',
      resourceId: contractId,
      sourceCommand: 'contract.lowerCurrentValueForVariation',
      eventType: 'CONTRACT_VALUE_LOWERED_BY_VARIATION_REVERSAL',
      idempotencyKey: `contract-value-lower-${contractId}-${variation.id}`,
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
      baseContractValue: contract.baseContractValue ? contract.baseContractValue.toFixed(2) : null,
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

    // ADR-023 CONST-COM-012: activation must not let a MILESTONE contract go live with a payment
    // schedule that does not reconcile to 100% — including the previously-open gap of ZERO
    // installments (an unset schedule, never populated via create() or replacePaymentPlan()).
    // Reuses the exact same check create()/replacePaymentPlan() already enforce on write, so there
    // is one reconciliation rule, not a second copy re-derived here.
    if (command === 'activate' && contract.billingModel === 'MILESTONE') {
      this.assertPaymentPlanReconciles(
        contract.paymentInstallments.map((installment) => ({
          sortOrder: installment.sortOrder,
          name: installment.name,
          percentage: installment.percentage.toNumber(),
          triggerType: installment.triggerType,
          dueOffsetDays: installment.dueOffsetDays ?? undefined,
          dueDate: installment.dueDate ? installment.dueDate.toISOString() : undefined,
        })),
      );
    }

    // On activation (DRAFT → ACTIVE), freeze client snapshots. This is the moment a physically-signed
    // contract goes live, so the client's identity is captured onto it as it stood at signature.
    const snapshotData: Record<string, string> = {};
    if (command === 'activate') {
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

    // Phase 7A: activation is the contract's real signature event, so from here its evidence is
    // part of the record. Outside the transaction because the file lifecycle is a second
    // aggregate and the freeze is idempotent — a retry finishes the job, a rollback would not
    // have to undo it.
    if (command === 'activate') {
      await this.attachments.freezeFor('CONTRACT', id, `evidence on activated contract ${id}`);
    }
    return result;
  }

  /**
   * Reverse a live contract back to DRAFT — the counter-move to `activate`.
   *
   * ACCO's contracts are prepared and signed on paper; a contract can be activated in the system
   * before that paperwork is final, so the workspace needs a way to pull it back and correct it.
   * Reopen clears the client snapshots frozen at activation, so DRAFT reads the live client again
   * and a subsequent re-activate re-freezes to the same end state.
   *
   * Per the owner decision, reopen is ALWAYS allowed on an ACTIVE contract (the UI carries a strong
   * confirmation) rather than being blocked once billing has started — the mandatory `reason` and the
   * CONTRACT_REOPENED audit event are the guard rails. If a safe boundary is wanted later, gate this
   * on "no invoice / receipt allocation / completed deliverable / applied variation" — deliberately
   * omitted now.
   *
   * Attachments are intentionally NOT thawed: the files platform exposes only `freezeFor` (immutability
   * is a one-way invariant), and it doesn't need reversing here — the sole frozen file pre-billing is
   * the signed-contract evidence, re-activate re-freezes it to an identical state, and a frozen file
   * can still be superseded through attachment replacement.
   */
  async reopen(identity: RequestIdentity, id: string, reason: string) {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, id);
    const fromStatus = contract.status;

    if (fromStatus !== 'ACTIVE') {
      throw new BadRequestException(
        `Cannot reopen a contract with status '${fromStatus}'. Only ACTIVE contracts can be reopened.`,
      );
    }

    return prisma.$transaction(async (tx) => {
      const updated = await this.repo.update(tx, id, {
        status: 'DRAFT',
        clientNameSnapshot: null,
        clientTaxSnapshot: null,
      });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'REOPEN',
        resourceType: 'Contract',
        resourceId: id,
        sourceCommand: 'contract.reopen',
        eventType: 'CONTRACT_REOPENED',
        idempotencyKey: `contract-reopen-${id}-${fromStatus}`,
        reason,
        before: { status: fromStatus },
        after: { status: 'DRAFT' },
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

  async releaseRetention(identity: RequestIdentity, id: string): Promise<ContractFull> {
    const prisma = this.tenancyService.getClient();
    const contract = await this.requireContract(prisma, identity, id);

    if (contract.status !== 'FINAL_ACCOUNT_PENDING') {
      throw new ConflictException(
        `Retention can only be released on a contract in FINAL_ACCOUNT_PENDING status (current: '${contract.status}').`,
      );
    }
    if (!contract.retentionTerms) {
      throw new BadRequestException('This contract has no retention terms to release.');
    }
    if (contract.retentionTerms.retentionReleasedAt) {
      throw new ConflictException('Retention has already been released on this contract.');
    }

    return prisma.$transaction(async (tx) => {
      const releasedAt = new Date();
      await tx.contractRetentionTerms.update({
        where: { contractId: id },
        data: { retentionReleasedAt: releasedAt },
      });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'ContractRetentionTerms',
        resourceId: id,
        sourceCommand: 'contract.releaseRetention',
        eventType: 'CONTRACT_RETENTION_RELEASED',
        idempotencyKey: `contract-retention-release-${id}`,
        before: { retentionReleasedAt: null },
        after: { retentionReleasedAt: releasedAt.toISOString() },
      });

      const updated = await this.repo.findById(tx as never, identity.activeOrganizationId, id);
      return updated!;
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
