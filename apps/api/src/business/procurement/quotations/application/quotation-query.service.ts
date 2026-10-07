import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkflowTransactionType, type RequestIdentity } from '@erp/types';
import { Decimal } from '@prisma/client/runtime/library';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { loadActorNames } from '../../../../platform/users/application/actor-names.js';
import { canSeeQuotationPhotos } from '../../../../platform/files/application/file-authorization.service.js';
import { moneyOrNull } from '../../shared/procurement-money.js';
import { distinctCount, normaliseStoreName } from '../domain/quote-count.policy.js';
import { lowestQuoteIds } from '../domain/quote-selection.policy.js';
import { allowedActions } from '../domain/quotation-state.policy.js';
import { slaTone, waitingMinutes, type SlaTone } from '../domain/quotation-sla.policy.js';
import {
  QuotationRequestRepository,
  type Db,
  type QuotationRequestAggregate,
} from '../infrastructure/quotation-request.repository.js';
import { QuotationAccessService } from './quotation-access.service.js';
import { QuotationWhatsAppAlerts } from './quotation-whatsapp-alerts.service.js';

export interface Person {
  id: string;
  name: string;
}

/** The SLA clock of a request that is waiting on finance; null otherwise. */
export function slaOf(
  request: { status: string; sentAt: Date | null; urgent: boolean },
  now: Date,
): { waitingWorkingMinutes: number | null; slaTone: SlaTone } {
  const waiting = request.status === 'AWAITING_DECISION' || request.status === 'AWARD_PENDING_APPROVAL';
  if (!waiting || !request.sentAt) return { waitingWorkingMinutes: null, slaTone: 'none' };
  const minutes = waitingMinutes(request.sentAt, now, { urgent: request.urgent });
  return { waitingWorkingMinutes: minutes, slaTone: slaTone(minutes) };
}

const dec = (v: Decimal | { toString(): string } | null) => (v === null ? null : new Decimal(v.toString()));

/**
 * ADR-044 §12 `GET /procurement/quotation-requests/:id` — and the body every command returns.
 * Money (estimate, entered totals, lowest, award) is null unless the caller holds
 * `view:commitment-ledger` or `award:quotation` (`moneyVisible`).
 */
@Injectable()
export class QuotationQueryService {
  /** Clock seam for tests (SLA colouring at seeded times). */
  now: () => Date = () => new Date();

  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: QuotationRequestRepository,
    private readonly access: QuotationAccessService,
    private readonly commandGovernance: CommandGovernanceService,
    private readonly alerts: QuotationWhatsAppAlerts,
  ) {}

  /**
   * The award's approval chain (ADR-044 §7): the pending instance while AWARD_PENDING_APPROVAL, or
   * the instance the award consumed. Null when no approval was involved.
   */
  private async approvalSummary(db: Db, request: QuotationRequestAggregate) {
    if (request.status !== 'AWARD_PENDING_APPROVAL' && !request.awardApprovalInstanceId) return null;
    const approval = await this.commandGovernance.latestApproval(WorkflowTransactionType.QUOTATION_AWARD, request.id);
    if (!approval) return null;
    const consumedByAward = approval.id === request.awardApprovalInstanceId;
    if (request.status !== 'AWARD_PENDING_APPROVAL' && !consumedByAward) return null;
    const name = await loadActorNames(db, approval.actions.map((a) => a.actorId));
    return {
      instanceId: approval.id,
      // A consumed instance is stored CANCELLED (ADR-015); the award it approved reads APPROVED.
      status: consumedByAward ? 'APPROVED' : approval.status,
      currentStepOrder: approval.currentStepOrder,
      currentStepRole: approval.currentStepRole,
      steps: approval.steps.map((step) => {
        const action = [...approval.actions]
          .reverse()
          .find((a) => a.stepOrder === step.stepOrder && a.action === 'APPROVE');
        return {
          stepOrder: step.stepOrder,
          roleRequired: step.roleRequired,
          approvedBy: action ? { id: action.actorId, name: name(action.actorId) } : null,
          approvedAt: action?.actedAt ?? null,
        };
      }),
    };
  }

  async detail(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const request = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!request) throw new NotFoundException(`Quotation request ${id} not found`);
    await this.access.assertProjectAccess(identity, request);
    return this.toDetail(prisma, identity, request);
  }

  async toDetail(db: Db, identity: RequestIdentity, request: QuotationRequestAggregate) {
    const orgId = identity.activeOrganizationId;
    const moneyVisible = this.access.moneyVisible(identity);
    const money = (d: Decimal | null) => moneyOrNull(moneyVisible, d);
    // Quote photos show supplier prices: the same rule as their file download (403 otherwise), so
    // a money-blind caller gets no file ids, hashes or reuse links — only page counts.
    const photosVisible = canSeeQuotationPhotos(identity);

    const [mr, linkedPo, project] = await Promise.all([
      this.repo.findMaterialRequest(db, orgId, request.materialRequestId),
      this.repo.linkedPurchaseOrder(db, request.purchaseOrderId),
      request.projectId
        ? db.project.findFirst({ where: { id: request.projectId, organizationId: orgId }, select: { id: true, code: true, name: true } })
        : Promise.resolve(null),
    ]);
    if (!mr) throw new NotFoundException(`Material request ${request.materialRequestId} not found`);

    const purchaseOrder = request.purchaseOrderId
      ? await db.purchaseOrder.findUnique({
          where: { id: request.purchaseOrderId },
          select: { id: true, poNumber: true, status: true },
        })
      : null;

    const caller = await this.access.callerFacts(identity, request, mr.requestedBy);
    const facts = this.access.facts(request, linkedPo);

    const hashes = photosVisible ? request.quotes.flatMap((q) => q.photos.map((p) => p.sha256)) : [];
    const reuse = await this.repo.findPhotoReuse(db, orgId, [...new Set(hashes)], request.id);

    // Likely registered suppliers for each new-store quote (same normalised name), so the selector
    // can award to an existing supplier instead of registering a duplicate.
    const newStores = request.quotes.filter((q) => q.status === 'ACTIVE' && !q.supplierId && q.storeName);
    const matches = await this.repo.findSuppliersByNormalisedName(
      db,
      orgId,
      [...new Set(newStores.map((q) => normaliseStoreName(q.storeName!)))],
    );

    const people = new Set<string>([request.createdBy, mr.requestedBy]);
    for (const q of request.quotes) {
      people.add(q.uploadedBy);
      if (q.enteredBy) people.add(q.enteredBy);
    }
    for (const id of [
      request.proposedBy,
      request.awardedBy,
      request.awardFinalApproverId,
      request.exceptionAcceptedBy,
      request.returnedBy,
      request.cancelledBy,
    ]) {
      if (id) people.add(id);
    }
    const name = await loadActorNames(db, people);
    const person = (id: string | null): Person | null => (id ? { id, name: name(id) } : null);

    const quotesForSelection = request.quotes.map((q) => ({
      id: q.id,
      status: q.status,
      enteredTotal: dec(q.enteredTotal),
    }));
    const lowest = new Set(lowestQuoteIds(quotesForSelection));
    const lowestTotal = request.quotes.find((q) => lowest.has(q.id))?.enteredTotal ?? null;
    const awardedSupplier = request.awardedSupplierId
      ? await db.supplier.findUnique({ where: { id: request.awardedSupplierId }, select: { id: true, code: true, name: true } })
      : null;

    return {
      id: request.id,
      number: request.number,
      status: request.status,
      urgent: request.urgent,
      currencyCode: request.currencyCode,
      materialRequest: {
        id: mr.id,
        number: mr.mrNumber,
        title: mr.title,
        priority: mr.priority,
        status: mr.status,
        requestedBy: person(mr.requestedBy)!,
        // The decision screen's "Needed by" (ADR-044 wireframe E).
        requiredByDate: mr.requiredByDate,
      },
      project,
      estimateAmount: money(dec(request.estimateAmount)),
      requiredQuoteCount: request.requiredQuoteCount,
      quoteCount: facts.activeQuoteCount,
      distinctSupplierCount: distinctCount(request.quotes),
      exceptionReason: request.exceptionReason,
      exceptionAccepted: request.exceptionAcceptedBy
        ? { by: person(request.exceptionAcceptedBy), at: request.exceptionAcceptedAt }
        : null,
      returnNote: request.returnNote,
      returnedBy: person(request.returnedBy),
      returnedAt: request.returnedAt,
      sendCount: request.sendCount,
      firstSentAt: request.firstSentAt,
      sentAt: request.sentAt,
      decidedAt: request.decidedAt,
      ...slaOf(request, this.now()),
      lowestTotal: money(dec(lowestTotal)),
      proposal: request.proposedQuoteId
        ? {
            quoteId: request.proposedQuoteId,
            proposedBy: person(request.proposedBy),
            proposedAt: request.proposedAt,
            paymentPath: request.proposedPaymentPath,
            nonLowestReason: request.proposedNonLowestReason,
            nonLowestNote: request.proposedNonLowestNote,
            supplierId: request.proposedSupplierId,
            acceptException: request.proposedAcceptException,
          }
        : null,
      award: request.awardedQuoteId
        ? {
            quoteId: request.awardedQuoteId,
            total: money(dec(request.awardedTotal)),
            supplier: awardedSupplier,
            awardedBy: person(request.awardedBy),
            awardedAt: request.awardedAt,
            approvalInstanceId: request.awardApprovalInstanceId,
            finalApprover: person(request.awardFinalApproverId),
            paymentPath: request.paymentPath,
            nonLowestReason: request.nonLowestReason,
            nonLowestNote: request.nonLowestNote,
          }
        : null,
      purchaseOrder,
      cancelledBy: person(request.cancelledBy),
      cancelledAt: request.cancelledAt,
      cancelReason: request.cancelReason,
      createdBy: person(request.createdBy)!,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      lines: mr.lines.map((line) => {
        const quantity = dec(line.approvedQuantity ?? line.requestedQuantity)!;
        const unit = dec(line.estimatedUnitPrice);
        return {
          id: line.id,
          lineNumber: line.lineNumber,
          description: line.description,
          quantity: quantity.toFixed(4),
          uom: line.uom ? { code: line.uom.code, name: line.uom.name } : null,
          estimatedUnitPrice: moneyVisible && unit ? unit.toFixed(4) : null,
          estimatedAmount: money(unit ? quantity.mul(unit) : null),
        };
      }),
      quotes: request.quotes.map((q) => ({
        id: q.id,
        store: {
          supplierId: q.supplierId,
          name: q.supplier?.name ?? q.storeName ?? '',
          registered: q.supplierId !== null,
        },
        status: q.status,
        rejectReason: q.rejectReason,
        rejectNote: q.rejectNote,
        replacesQuoteId: q.replacesQuoteId,
        uploadedBy: person(q.uploadedBy)!,
        createdAt: q.createdAt,
        photoCount: q.photos.length,
        photos: (photosVisible ? q.photos : []).map((p) => ({
          id: p.id,
          fileId: p.platformFileId,
          pageNumber: p.pageNumber,
          capturedAt: p.capturedAt,
          receivedAt: p.receivedAt,
          source: p.source,
          sha256: p.sha256,
          reusedOn: reuse.get(p.sha256) ?? [],
        })),
        enteredTotal: money(dec(q.enteredTotal)),
        enteredBy: person(q.enteredBy),
        enteredAt: q.enteredAt,
        isLowest: moneyVisible ? lowest.has(q.id) : null,
      })),
      supplierMatches: newStores
        .map((q) => ({
          quoteId: q.id,
          suppliers: matches
            .filter((m) => m.norm === normaliseStoreName(q.storeName!))
            .map((m) => ({ id: m.id, code: m.code, name: m.name })),
        }))
        .filter((m) => m.suppliers.length > 0),
      approval: await this.approvalSummary(db, request),
      allowedActions: allowedActions(facts, caller).map(({ action, enabled, reasonCode }) => ({
        action,
        enabled,
        reasonCode,
      })),
      moneyVisible,
      /** False → every quote's `photos` is [] (see `photoCount`): "Quote photos are hidden for your role". */
      photosVisible,
      /**
       * ADR-044 phase 2 — WhatsApp alerts about this request, oldest first: who, which alert, status.
       * Numbers masked to the last 3 digits; no message text, no amounts.
       */
      messages: await this.alerts.deliveryLog(db, orgId, request.id),
    };
  }
}
