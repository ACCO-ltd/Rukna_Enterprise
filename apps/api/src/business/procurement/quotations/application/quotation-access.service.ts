import { Injectable } from '@nestjs/common';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';
import { availabilityError } from '../domain/quotation-errors.js';
import {
  actionAvailability,
  type CallerFacts,
  type LinkedPurchaseOrderFacts,
  type QuotationAction,
  type QuotationFacts,
} from '../domain/quotation-state.policy.js';
import type { QuotationRequestAggregate } from '../infrastructure/quotation-request.repository.js';

/**
 * Who the caller is with respect to one quotation request: the permission flags, the money
 * visibility, and the SoD bar on selecting (ADR-044 §5–§6). Shared by every command and the read
 * model, so "may I?" and "why can't I?" are computed once, the same way.
 */
@Injectable()
export class QuotationAccessService {
  constructor(
    private readonly sod: SegregationOfDutiesService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /** ADR-044 §5 — money on quotations: cost visibility, or the selector's own authority. */
  moneyVisible(identity: RequestIdentity): boolean {
    return (
      identity.permissions.includes(PERMISSIONS.commitmentsView) ||
      identity.permissions.includes(PERMISSIONS.quotationsAward)
    );
  }

  /** A request on a project is reachable only by that project's members (or the bypass roles). */
  async assertProjectAccess(identity: RequestIdentity, request: { projectId: string | null }) {
    if (request.projectId) await this.projectAccess.assertMember(identity, request.projectId);
  }

  /**
   * Everyone who touched the evidence: the request's creator and the uploader of every quote and
   * photo, WITHDRAWN and REJECTED ones included (ADR-044 §6 — having touched it is enough).
   */
  evidenceTouchers(request: QuotationRequestAggregate): string[] {
    const ids = new Set<string>([request.createdBy]);
    for (const quote of request.quotes) {
      ids.add(quote.uploadedBy);
      for (const photo of quote.photos) ids.add(photo.uploadedBy);
    }
    return [...ids];
  }

  /**
   * The SoD rule barring `actorUserId` from selecting on this request, or null. `activeCodes` may be
   * passed in when evaluating several actors (the award's approvers) against one rule set.
   */
  async selectionBarredBy(
    organizationId: string,
    actorUserId: string,
    request: QuotationRequestAggregate,
    requesterUserId: string,
    activeCodes?: Set<string>,
  ): Promise<string | null> {
    // Q3: the SELECT_QUOTATION rules land with the selector commands (Q4).
    void this.sod;
    void [organizationId, actorUserId, request, requesterUserId, activeCodes];
    return null;
  }

  async callerFacts(
    identity: RequestIdentity,
    request: QuotationRequestAggregate,
    requesterUserId: string,
  ): Promise<CallerFacts> {
    const has = (p: string) => identity.permissions.includes(p);
    const canAward = has(PERMISSIONS.quotationsAward);
    return {
      canCollect: has(PERMISSIONS.quotationsCollect),
      canAward,
      canCreatePurchaseOrder: has(PERMISSIONS.purchaseOrdersCreate),
      // Only a selector can be barred from selecting; skip the rule read for everyone else.
      selectionBarredBy: canAward
        ? await this.selectionBarredBy(identity.activeOrganizationId, identity.userId, request, requesterUserId)
        : null,
    };
  }

  facts(request: QuotationRequestAggregate, linkedPurchaseOrder: LinkedPurchaseOrderFacts | null): QuotationFacts {
    const active = request.quotes.filter((q) => q.status === 'ACTIVE');
    return {
      status: request.status,
      linkedPurchaseOrder,
      activeQuoteCount: active.length,
      activeQuotesWithoutTotal: active.filter((q) => q.enteredTotal === null || Number(q.enteredTotal) <= 0).length,
    };
  }

  /** Throws the command's 403/409 when `action` is not available to this caller now. */
  assertAvailable(action: QuotationAction, facts: QuotationFacts, caller: CallerFacts): void {
    const availability = actionAvailability(action, facts, caller);
    if (!availability.enabled) throw availabilityError(availability);
  }
}
