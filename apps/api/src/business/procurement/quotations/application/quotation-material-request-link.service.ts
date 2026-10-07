import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { quotationConflict } from '../domain/quotation-errors.js';
import { distinctCount } from '../domain/quote-count.policy.js';
import { QuotationRequestRepository, type Db } from '../infrastructure/quotation-request.repository.js';
import { QuotationCollectService } from './quotation-collect.service.js';
import { QuotationCommandRunner } from './quotation-command-runner.service.js';

/**
 * What the material-request module needs to know about quotations, without importing the
 * quotation services: the cancel cascade (ADR-044 Q3) and the MR detail summary (Q8).
 */
@Injectable()
export class QuotationMaterialRequestLink {
  constructor(
    private readonly repo: QuotationRequestRepository,
    private readonly runner: QuotationCommandRunner,
    private readonly collect: QuotationCollectService,
  ) {}

  /**
   * Inside the MR-cancel transaction: cancels the MR's live quotation request, unless it was
   * awarded and a purchase order raised from the award is still live (409 — cancel the order first).
   * Returns the request whose pending award approval must be voided after commit, if any.
   */
  async cancelForMaterialRequest(
    tx: Prisma.TransactionClient,
    identity: RequestIdentity,
    materialRequestId: string,
  ): Promise<{ voidAwardApprovalFor: string | null }> {
    const live = await this.repo.findLiveForMaterialRequest(tx, identity.activeOrganizationId, materialRequestId);
    if (!live) return { voidAwardApprovalFor: null };
    const ctx = await this.runner.context(tx, identity, live.id);
    if (ctx.request.status === 'AWARDED' && ctx.linkedPo && ctx.linkedPo.status !== 'CANCELLED') {
      throw quotationConflict(
        'PURCHASE_ORDER_LIVE',
        `A purchase order was raised from quotation ${ctx.request.number}. Cancel that order before cancelling the material request.`,
      );
    }
    await this.collect.cancelInContext(ctx, 'Material request cancelled', 'mr.cancel');
    return { voidAwardApprovalFor: ctx.request.status === 'AWARD_PENDING_APPROVAL' ? live.id : null };
  }

  /** The MR detail's `quotation` field: the live request's progress, or null. */
  async summaryForMaterialRequest(db: Db, organizationId: string, materialRequestId: string) {
    const live = await this.repo.findLiveForMaterialRequest(db, organizationId, materialRequestId);
    if (!live) return null;
    return {
      id: live.id,
      number: live.number,
      status: live.status,
      quoteCount: live.quotes.filter((q) => q.status === 'ACTIVE').length,
      distinctSupplierCount: distinctCount(live.quotes),
      requiredQuoteCount: live.requiredQuoteCount,
    };
  }
}
