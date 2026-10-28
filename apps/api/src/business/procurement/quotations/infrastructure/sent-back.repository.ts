import { Injectable } from '@nestjs/common';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';

/** Step 7 — what a collector was asked to redo. */
@Injectable()
export class SentBackRepository {
  constructor(private readonly tenancy: TenancyService) {}

  /** Rounds this user opened that came back for more quotes (still RETURNED). */
  returnedRounds(organizationId: string, userId: string) {
    return this.tenancy.getClient().quotationRequest.findMany({
      where: { organizationId, createdBy: userId, status: 'RETURNED' },
      select: { id: true, number: true, returnNote: true, returnedAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  /** Quotes this user added that were rejected, on rounds still open, with the round's quote times. */
  rejectedQuotes(organizationId: string, userId: string) {
    return this.tenancy.getClient().quote.findMany({
      where: {
        uploadedBy: userId,
        status: 'REJECTED',
        quotationRequest: { organizationId, status: { in: ['COLLECTING', 'RETURNED', 'AWAITING_DECISION'] } },
      },
      select: {
        id: true, rejectReason: true, rejectNote: true, updatedAt: true, storeName: true,
        supplier: { select: { name: true } },
        quotationRequest: { select: { id: true, number: true, quotes: { select: { createdAt: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  /** Receipt photos this user sent that finance rejected, unless a newer one went in for the same order. */
  rejectedReceipts(organizationId: string, userId: string) {
    return this.tenancy.getClient().storeDocument.findMany({
      where: { organizationId, uploadedBy: userId, status: 'REJECTED', quotationRequestId: { not: null } },
      select: {
        id: true, number: true, rejectReason: true, rejectNote: true, rejectedAt: true, createdAt: true, purchaseOrderId: true, quotationRequestId: true,
        purchaseOrder: { select: { supplier: { select: { name: true } }, storeDocuments: { where: { status: { in: ['SUBMITTED', 'RECORDED'] } }, select: { createdAt: true } } } },
      },
      orderBy: { rejectedAt: 'desc' },
      take: 50,
    });
  }
}
