import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { quotationBadRequest, quotationConflict } from '../domain/quotation-errors.js';
import { parseQuoteTotal } from '../domain/quote-selection.policy.js';
import { QuotationCommandRunner, type CommandContext } from './quotation-command-runner.service.js';
import { QuotationQueryService } from './quotation-query.service.js';
import { QuotationNotifier } from './quotation-notifier.service.js';

export type QuoteRejectReasonInput = 'ILLEGIBLE' | 'WRONG_ITEMS' | 'INCOMPLETE' | 'OTHER';

/**
 * ADR-044 Q4 — the selector's (finance's) commands on a request awaiting decision: type each
 * quote's total (the only place a quotation number is ever created), reject a quote, or ask the
 * collector for another quote. Every one is gated by `award:quotation` and the SELECT_QUOTATION
 * segregation of duties (not the request's creator or any uploader; not the MR's requester).
 */
@Injectable()
export class QuotationSelectionService {
  constructor(
    private readonly runner: QuotationCommandRunner,
    private readonly query: QuotationQueryService,
    private readonly notifier: QuotationNotifier,
  ) {}

  /** Overwritable until award; every write audited with before/after. */
  async enterTotal(identity: RequestIdentity, id: string, quoteId: string, total: string) {
    const value = parseQuoteTotal(total);
    if (!value) {
      throw quotationBadRequest(
        'TOTAL_INVALID',
        'A total is a positive amount with at most 2 decimals, up to 999,999,999.99.',
      );
    }
    await this.runner.run(identity, id, 'ENTER_TOTAL', async (ctx) => {
      const quote = activeQuote(ctx, quoteId);
      await ctx.tx.quote.update({
        where: { id: quote.id },
        data: { enteredTotal: value, enteredBy: identity.userId, enteredAt: new Date() },
      });
      const updated = await this.runner.writeRequest(ctx, 'AWAITING_DECISION', {});
      await this.runner.audit(ctx, updated.updatedAt, {
        eventType: 'QUOTE_TOTAL_ENTERED',
        sourceCommand: 'quotation.enter-total',
        action: 'UPDATE',
        keySuffix: quote.id,
        before: { quoteId: quote.id, enteredTotal: quote.enteredTotal?.toString() ?? null },
        after: { quoteId: quote.id, enteredTotal: value.toFixed(2) },
      });
    });
    return this.query.detail(identity, id);
  }

  /** The quote leaves the comparison (counts and lowest). */
  async rejectQuote(identity: RequestIdentity, id: string, quoteId: string, reason: QuoteRejectReasonInput, note?: string) {
    await this.runner.run(identity, id, 'REJECT_QUOTE', async (ctx) => {
      const quote = activeQuote(ctx, quoteId);
      await ctx.tx.quote.update({
        where: { id: quote.id },
        data: { status: 'REJECTED', rejectReason: reason, rejectNote: note?.trim() || null },
      });
      const updated = await this.runner.writeRequest(ctx, 'AWAITING_DECISION', {});
      await this.runner.audit(ctx, updated.updatedAt, {
        eventType: 'QUOTE_REJECTED',
        sourceCommand: 'quotation.reject-quote',
        action: 'UPDATE',
        keySuffix: quote.id,
        before: { quoteId: quote.id, quoteStatus: 'ACTIVE' },
        after: { quoteId: quote.id, quoteStatus: 'REJECTED', rejectReason: reason },
        reason: note?.trim() || undefined,
      });
    });
    return this.query.detail(identity, id);
  }

  /** S6 — back to the collector with a note: AWAITING_DECISION → RETURNED; closes this SLA cycle. */
  async askAnother(identity: RequestIdentity, id: string, note: string) {
    const text = note?.trim();
    if (!text) throw quotationBadRequest('NOTE_REQUIRED', 'Tell the collector what to fetch.');
    await this.runner.run(identity, id, 'ASK_ANOTHER', async (ctx) => {
      const now = new Date();
      const updated = await this.runner.writeRequest(ctx, 'AWAITING_DECISION', {
        status: 'RETURNED',
        returnNote: text,
        returnedBy: identity.userId,
        returnedAt: now,
        decidedAt: now,
      });
      await this.runner.audit(ctx, updated.updatedAt, {
        eventType: 'QUOTATION_RETURNED',
        sourceCommand: 'quotation.ask-another',
        before: { status: 'AWAITING_DECISION' },
        after: { status: 'RETURNED' },
        reason: text,
      });
      await this.notifier.returned(ctx, updated, text);
    });
    return this.query.detail(identity, id);
  }
}

function activeQuote(ctx: CommandContext, quoteId: string) {
  const quote = ctx.request.quotes.find((q) => q.id === quoteId);
  if (!quote) throw new NotFoundException(`Quote ${quoteId} not found on this request`);
  if (quote.status !== 'ACTIVE') throw quotationConflict('QUOTE_NOT_ACTIVE');
  return quote;
}
