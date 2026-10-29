import { Injectable } from '@nestjs/common';
import type { RequestIdentity, SentBackItem } from '@erp/types';

import { SentBackRepository } from '../infrastructure/sent-back.repository.js';

/**
 * Step 7 — the phone Home's first section: what the signed-in collector was asked to redo, newest
 * first. Only their own items, and only while there is still something to do: a returned round
 * that is still RETURNED, a rejected quote with no newer quote added to its round since the
 * rejection, a rejected receipt with no newer receipt sent for the same order.
 */
@Injectable()
export class SentBackService {
  constructor(private readonly repo: SentBackRepository) {}

  async list(identity: RequestIdentity): Promise<SentBackItem[]> {
    const org = identity.activeOrganizationId;
    const me = identity.userId;
    const [rounds, quotes, receipts] = await Promise.all([
      this.repo.returnedRounds(org, me),
      this.repo.rejectedQuotes(org, me),
      this.repo.rejectedReceipts(org, me),
    ]);

    const items: SentBackItem[] = [
      ...rounds.map((r) => ({
        kind: 'QUOTATION_RETURNED' as const,
        id: r.id,
        quotationRequestId: r.id,
        number: r.number,
        storeName: null,
        reason: null,
        note: r.returnNote,
        at: (r.returnedAt ?? r.updatedAt).toISOString(),
      })),
      ...quotes
        // updatedAt is the rejection: a rejected quote is not edited again.
        .filter((q) => !q.quotationRequest.quotes.some((other) => other.createdAt > q.updatedAt))
        .map((q) => ({
          kind: 'QUOTE_REJECTED' as const,
          id: q.id,
          quotationRequestId: q.quotationRequest.id,
          number: q.quotationRequest.number,
          storeName: q.supplier?.name ?? q.storeName,
          reason: q.rejectReason,
          note: q.rejectNote,
          at: q.updatedAt.toISOString(),
        })),
      ...receipts
        .filter((d) => !d.purchaseOrder.storeDocuments.some((other) => other.createdAt > d.createdAt))
        .map((d) => ({
          kind: 'RECEIPT_REJECTED' as const,
          id: d.id,
          quotationRequestId: d.quotationRequestId!,
          number: d.number,
          storeName: d.purchaseOrder.supplier.name,
          reason: d.rejectReason,
          note: d.rejectNote,
          at: (d.rejectedAt ?? d.createdAt).toISOString(),
        })),
    ];
    return items.sort((a, b) => b.at.localeCompare(a.at));
  }
}
