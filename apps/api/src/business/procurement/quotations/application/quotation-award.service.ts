import { Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, WorkflowTransactionType, type RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { ApprovalService } from '../../../../platform/workflows/application/approval.service.js';
import { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';
import { quotationBadRequest, quotationConflict, quotationForbidden } from '../domain/quotation-errors.js';
import { countBlock, distinctCount, requiredCount } from '../domain/quote-count.policy.js';
import { awardBlock, lowestQuoteIds } from '../domain/quote-selection.policy.js';
import { QuotationRequestRepository } from '../infrastructure/quotation-request.repository.js';
import { QuotationAccessService } from './quotation-access.service.js';
import { QuotationCommandRunner, type CommandContext } from './quotation-command-runner.service.js';
import { QuotationQueryService } from './quotation-query.service.js';

export type QuotationPaymentPathInput = 'BUYER_CASH' | 'FINANCE_PAYS_SUPPLIER';
export type NonLowestReasonInput = 'FASTER_DELIVERY' | 'BETTER_QUALITY' | 'HAS_STOCK' | 'OTHER';

export interface AwardInput {
  quoteId?: string;
  paymentPath?: QuotationPaymentPathInput;
  nonLowestReason?: NonLowestReasonInput;
  nonLowestNote?: string;
  acceptException?: boolean;
  /** Award a new store's quote to this existing registered supplier instead of registering one. */
  awardSupplierId?: string;
}

const MAX_SELF_STEPS = 10;

/**
 * ADR-044 Q5 — the award, which IS the purchase order's DoA approval (§7).
 *
 * `award` on AWAITING_DECISION proposes (one transaction: the choice is persisted and the request
 * parks in AWARD_PENDING_APPROVAL), then asks governance whether the award transition is gated
 * (QuotationRequest AWAITING_DECISION → AWARDED, valued at the chosen total, the PO bands):
 *  - no active band → the award completes in the same call;
 *  - a band → the proposer's own step is recorded as their approval when it is current (selection
 *    counts as the selector's approval); a fully approved chain completes the award, otherwise the
 *    standard 409 `{ approvalInstanceId }` is returned and approvers act on the workflow endpoints.
 * `award` on AWARD_PENDING_APPROVAL is the ADR-015 re-drive (same body, or `{}`). Before an approval
 * is consumed, every approver recorded on it is vetted against SELECT_QUOTATION SoD (an uploader or
 * the MR requester may not approve the award either); a violation voids the instance (403).
 */
@Injectable()
export class QuotationAwardService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: QuotationRequestRepository,
    private readonly access: QuotationAccessService,
    private readonly runner: QuotationCommandRunner,
    private readonly query: QuotationQueryService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly commandGovernance: CommandGovernanceService,
    private readonly approvals: ApprovalService,
    private readonly sod: SegregationOfDutiesService,
  ) {}

  async award(identity: RequestIdentity, id: string, input: AwardInput) {
    const orgId = identity.activeOrganizationId;

    // Propose, or validate a re-drive, under the row lock (SoD for the caller runs in the policy).
    await this.runner.run(identity, id, 'AWARD', async (ctx) => {
      if (ctx.request.status === 'AWAITING_DECISION') return this.propose(ctx, input);
      if (input.quoteId && input.quoteId !== ctx.request.proposedQuoteId) {
        throw quotationConflict('AWARD_PENDING_DIFFERENT_CHOICE');
      }
    });

    const prisma = this.tenancy.getClient();
    const request = await this.repo.findById(prisma, orgId, id);
    if (!request?.proposedQuoteId) throw quotationConflict('QUOTATION_CHANGED');
    const mr = await this.repo.findMaterialRequest(prisma, orgId, request.materialRequestId);
    if (!mr) throw new NotFoundException(`Material request ${request.materialRequestId} not found`);
    const chosen = request.quotes.find((q) => q.id === request.proposedQuoteId)!;
    const total = new Decimal(chosen.enteredTotal!.toString());

    let consumed: { instanceId: string; finalApproverId: string | null } | null = null;
    let lastGateId: string | null = null;
    for (let i = 0; ; i++) {
      const approval = await this.commandGovernance.latestApproval(WorkflowTransactionType.QUOTATION_AWARD, id);
      const live = approval && (approval.status === 'PENDING' || approval.status === 'APPROVED') ? approval : null;
      if (live) await this.assertApproversMaySelect(orgId, request, mr.requestedBy, live);

      // Selection counts as the selector's approval: the proposer approves their own step.
      if (
        live?.status === 'PENDING' &&
        i < MAX_SELF_STEPS &&
        request.proposedBy === identity.userId &&
        live.currentStepRole !== null &&
        identity.roles.includes(live.currentStepRole)
      ) {
        await this.approvals.approve(
          live.id,
          identity.userId,
          identity.roles,
          orgId,
          `Selected in quotation ${request.number}`,
        );
        continue;
      }

      const outcome = await this.commandGovernance.evaluateStateTransition(
        identity,
        'QuotationRequest',
        'AWAITING_DECISION',
        'AWARDED',
        id,
        total,
      );
      if (!outcome.gate) {
        consumed = outcome.consumedApproval;
        break;
      }
      // A freshly opened instance may start with the proposer's own step — look once more.
      if (outcome.gate.approvalInstanceId !== lastGateId && outcome.gate.approvalInstanceId !== live?.id) {
        lastGateId = outcome.gate.approvalInstanceId;
        continue;
      }
      throw quotationConflict('AWARD_PENDING_APPROVAL', 'The award needs workflow approval before it takes effect.', {
        approvalInstanceId: outcome.gate.approvalInstanceId,
      });
    }

    await this.complete(identity, id, consumed);
    return this.query.detail(identity, id);
  }

  /** Back to AWAITING_DECISION; the open approval instance is voided. */
  async withdrawAward(identity: RequestIdentity, id: string) {
    await this.runner.run(identity, id, 'WITHDRAW_AWARD', async (ctx) => {
      const updated = await this.runner.writeRequest(ctx, 'AWARD_PENDING_APPROVAL', {
        status: 'AWAITING_DECISION',
        ...CLEARED_PROPOSAL,
      });
      await this.runner.audit(ctx, updated.updatedAt, {
        eventType: 'QUOTATION_AWARD_WITHDRAWN',
        sourceCommand: 'quotation.withdraw-award',
        before: { status: 'AWARD_PENDING_APPROVAL', quoteId: ctx.request.proposedQuoteId },
        after: { status: 'AWAITING_DECISION' },
      });
    });
    await this.commandGovernance.voidOpenApproval(WorkflowTransactionType.QUOTATION_AWARD, id);
    return this.query.detail(identity, id);
  }

  /** Persist the choice: AWAITING_DECISION → AWARD_PENDING_APPROVAL (tx 1). */
  private async propose(ctx: CommandContext, input: AwardInput) {
    if (!input.quoteId) throw quotationBadRequest('QUOTE_REQUIRED', 'Choose a quote to award.');
    if (!input.paymentPath) throw quotationBadRequest('PAYMENT_PATH_REQUIRED', 'Choose how the supplier is paid.');

    const quotes = ctx.request.quotes.map((q) => ({
      id: q.id,
      status: q.status,
      enteredTotal: q.enteredTotal === null ? null : new Decimal(q.enteredTotal.toString()),
    }));
    const block = awardBlock({
      quotes,
      chosenQuoteId: input.quoteId,
      nonLowestReason: input.nonLowestReason,
      nonLowestNote: input.nonLowestNote,
    });
    if (block) throw quotationConflict(block);

    const chosen = ctx.request.quotes.find((q) => q.id === input.quoteId)!;
    const total = new Decimal(chosen.enteredTotal!.toString());
    const estimate = ctx.request.estimateAmount === null ? null : new Decimal(ctx.request.estimateAmount.toString());
    const required = requiredCount(estimate, total);
    const distinct = distinctCount(ctx.request.quotes);
    const short = distinct < required;
    const count = countBlock({
      distinct,
      required,
      exceptionReason: ctx.request.exceptionReason,
      acceptException: input.acceptException === true,
    });
    if (count) throw quotationConflict(count, undefined, { required, distinct });

    const supplierId = await this.resolveSupplier(ctx, chosen, input.awardSupplierId);
    const isLowest = lowestQuoteIds(quotes).includes(chosen.id);

    const updated = await this.runner.writeRequest(ctx, 'AWAITING_DECISION', {
      status: 'AWARD_PENDING_APPROVAL',
      requiredQuoteCount: required,
      proposedQuoteId: chosen.id,
      proposedBy: ctx.identity.userId,
      proposedAt: new Date(),
      proposedPaymentPath: input.paymentPath,
      proposedNonLowestReason: isLowest ? null : input.nonLowestReason!,
      proposedNonLowestNote: isLowest ? null : input.nonLowestNote?.trim() || null,
      proposedSupplierId: supplierId,
      proposedAcceptException: short,
    });
    await this.runner.audit(ctx, updated.updatedAt, {
      eventType: 'QUOTATION_AWARD_PROPOSED',
      sourceCommand: 'quotation.award',
      before: { status: 'AWAITING_DECISION' },
      after: {
        status: 'AWARD_PENDING_APPROVAL',
        quoteId: chosen.id,
        total: total.toFixed(2),
        paymentPath: input.paymentPath,
        nonLowestReason: isLowest ? null : input.nonLowestReason,
        supplierId,
        exceptionAccepted: short,
        requiredQuoteCount: required,
        distinctSupplierCount: distinct,
      },
    });
  }

  /**
   * The registered supplier the award goes to: the quote's own (must be ACTIVE), or — for a new
   * store — the selector's chosen existing supplier, or null meaning "register the store when the
   * award completes", which needs the proposer to hold manage:payable (§8).
   */
  private async resolveSupplier(
    ctx: CommandContext,
    chosen: CommandContext['request']['quotes'][number],
    awardSupplierId: string | undefined,
  ): Promise<string | null> {
    const orgId = ctx.request.organizationId;
    if (chosen.supplierId) {
      if (awardSupplierId && awardSupplierId !== chosen.supplierId) {
        throw quotationBadRequest(
          'AWARD_SUPPLIER_OVERRIDE_NOT_ALLOWED',
          'This quote is from a registered supplier; the award goes to that supplier.',
        );
      }
      const supplier = await this.repo.findSupplier(ctx.tx, orgId, chosen.supplierId);
      if (!supplier || supplier.status !== 'ACTIVE') throw quotationConflict('SUPPLIER_INACTIVE');
      return supplier.id;
    }
    if (awardSupplierId) {
      const supplier = await this.repo.findSupplier(ctx.tx, orgId, awardSupplierId);
      if (!supplier) throw new NotFoundException(`Supplier ${awardSupplierId} not found`);
      if (supplier.status !== 'ACTIVE') throw quotationConflict('SUPPLIER_INACTIVE');
      return supplier.id;
    }
    if (!ctx.identity.permissions.includes(PERMISSIONS.payablesManage)) {
      // Product owner 2026-10-07: keep as designed — a Finance Officer registers the store first.
      throw quotationForbidden(
        'SUPPLIER_REGISTRATION_REQUIRES_PAYABLES',
        `${chosen.storeName} is not a registered supplier. A Finance Officer must register it first ` +
          '(Suppliers), then choose it here as the supplier.',
      );
    }
    return null;
  }

  /**
   * ADR-044 §6 — nobody who uploaded evidence (or requested the MR) may approve the award either.
   * The generic approval engine has no such check, so it is enforced here, before consumption; a
   * violation voids the instance so a clean chain must be run.
   */
  private async assertApproversMaySelect(
    organizationId: string,
    request: CommandContext['request'],
    requesterUserId: string,
    approval: { id: string; actions: Array<{ action: string; actorId: string }> },
  ) {
    const approvers = [...new Set(approval.actions.filter((a) => a.action === 'APPROVE').map((a) => a.actorId))];
    if (approvers.length === 0) return;
    const codes = await this.sod.activeRuleCodes(organizationId);
    for (const approverId of approvers) {
      const barred = await this.access.selectionBarredBy(organizationId, approverId, request, requesterUserId, codes);
      if (barred) {
        await this.commandGovernance.voidOpenApproval(WorkflowTransactionType.QUOTATION_AWARD, request.id);
        throw quotationForbidden(
          barred,
          `Segregation-of-duties rule '${barred}' prohibits an approver of this award; the approval was voided and must be run again by eligible approvers.`,
        );
      }
    }
  }

  /** tx 2: AWARD_PENDING_APPROVAL → AWARDED, registering a new store as a supplier if needed. */
  private async complete(
    identity: RequestIdentity,
    id: string,
    consumed: { instanceId: string; finalApproverId: string | null } | null,
  ) {
    const prisma = this.tenancy.getClient();
    await prisma.$transaction(async (tx) => {
      const ctx = await this.runner.context(tx, identity, id);
      const request = ctx.request;
      if (request.status !== 'AWARD_PENDING_APPROVAL' || !request.proposedQuoteId || !request.proposedBy) {
        throw quotationConflict('QUOTATION_CHANGED');
      }
      const chosen = request.quotes.find((q) => q.id === request.proposedQuoteId)!;
      let supplierId = request.proposedSupplierId;
      const now = new Date();

      if (!supplierId) {
        const code = await this.repo.nextQuotationSupplierCode(tx, request.organizationId);
        const supplier = await tx.supplier.create({
          data: {
            organizationId: request.organizationId,
            code,
            name: chosen.storeName!,
            defaultCurrency: request.currencyCode,
            status: 'ACTIVE',
            // The selector registers the store and becomes its vendor maintainer (so the collector
            // who raises the PO passes VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT).
            createdBy: request.proposedBy,
          },
        });
        supplierId = supplier.id;
        // The store is now a registered supplier: the quote names it from here on (its photos and
        // total are untouched), so a re-decision cannot register the same store twice.
        await tx.quote.update({ where: { id: chosen.id }, data: { supplierId: supplier.id, storeName: null } });
        await this.auditOutbox.record(tx, {
          organizationId: request.organizationId,
          actorUserId: request.proposedBy,
          action: 'CREATE',
          resourceType: 'Supplier',
          resourceId: supplier.id,
          sourceCommand: 'quotation.award',
          eventType: 'SUPPLIER_CREATED_FROM_QUOTATION',
          idempotencyKey: `supplier-from-quotation-${supplier.id}`,
          after: { code, name: supplier.name, quotationRequestId: request.id, quotationNumber: request.number, quoteId: chosen.id },
        });
      }

      const updated = await this.runner.writeRequest(ctx, 'AWARD_PENDING_APPROVAL', {
        status: 'AWARDED',
        awardedQuoteId: chosen.id,
        awardedTotal: chosen.enteredTotal,
        awardedSupplierId: supplierId,
        awardedBy: request.proposedBy,
        awardedAt: now,
        awardApprovalInstanceId: consumed?.instanceId ?? null,
        awardFinalApproverId: consumed?.finalApproverId ?? null,
        nonLowestReason: request.proposedNonLowestReason,
        nonLowestNote: request.proposedNonLowestNote,
        paymentPath: request.proposedPaymentPath,
        exceptionAcceptedBy: request.proposedAcceptException ? request.proposedBy : null,
        exceptionAcceptedAt: request.proposedAcceptException ? request.proposedAt : null,
        decidedAt: now,
        ...CLEARED_PROPOSAL,
      });
      await this.runner.audit(ctx, updated.updatedAt, {
        eventType: 'QUOTATION_AWARDED',
        sourceCommand: 'quotation.award',
        before: { status: 'AWARD_PENDING_APPROVAL' },
        after: {
          status: 'AWARDED',
          quoteId: chosen.id,
          awardedTotal: chosen.enteredTotal?.toString() ?? null,
          supplierId,
          awardedBy: request.proposedBy,
          finalApproverId: consumed?.finalApproverId ?? null,
          paymentPath: request.proposedPaymentPath,
        },
        approvalInstanceId: consumed?.instanceId,
      });
    });
  }
}

const CLEARED_PROPOSAL = {
  proposedQuoteId: null,
  proposedBy: null,
  proposedAt: null,
  proposedPaymentPath: null,
  proposedNonLowestReason: null,
  proposedNonLowestNote: null,
  proposedSupplierId: null,
  proposedAcceptException: false,
} as const;
