import { Injectable } from '@nestjs/common';
import type { NotificationKind, QuotationNotificationContext } from '@erp/types';
import { PERMISSIONS } from '@erp/types';

import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';
import { NotificationWriter } from '../../../../platform/notifications/application/notification-writer.service.js';
import { QuotationAccessService } from './quotation-access.service.js';
import type { CommandContext } from './quotation-command-runner.service.js';

const RESOURCE_TYPE = 'QuotationRequest';
const ALL_KINDS: NotificationKind[] = ['QUOTES_READY', 'QUOTATION_AWARDED', 'ANOTHER_QUOTE_REQUESTED'];

/** The request state an event is announced from (after the command's write). */
export interface NotifiedRequest {
  sendCount: number;
  updatedAt: Date;
}

/**
 * ADR-044 §10 — who hears about a quotation request, and when. Written in the command's own
 * transaction through the NotificationWriter.
 *
 * | Kind                    | When          | To                                              | Resolved by                       |
 * |-------------------------|---------------|-------------------------------------------------|-----------------------------------|
 * | QUOTES_READY            | send          | active award:quotation holders minus SoD-barred | award (proposed), ask-another,    |
 * |                         |               |                                                 | reopen, cancel                    |
 * | QUOTATION_AWARDED       | award done    | the request creator + quote uploaders           | order raised, re-decision, cancel |
 * | ANOTHER_QUOTE_REQUESTED | ask-another   | the request creator + quote uploaders           | next send, cancel                 |
 *
 * Recipients are all award holders, not band-specific: the value is unknown until finance types
 * the totals, so band routing happens through the award's approval instance instead.
 */
@Injectable()
export class QuotationNotifier {
  constructor(
    private readonly writer: NotificationWriter,
    private readonly access: QuotationAccessService,
    private readonly sod: SegregationOfDutiesService,
  ) {}

  async sent(ctx: CommandContext, after: NotifiedRequest) {
    await this.resolve(ctx, ['ANOTHER_QUOTE_REQUESTED']);
    await this.toSelectors(ctx, `quotation:${ctx.request.id}:QUOTES_READY:${after.sendCount}`);
  }

  async reopened(ctx: CommandContext) {
    await this.resolve(ctx, ['QUOTES_READY']);
  }

  async returned(ctx: CommandContext, after: NotifiedRequest, note: string) {
    await this.resolve(ctx, ['QUOTES_READY']);
    await this.toCollectors(ctx, 'ANOTHER_QUOTE_REQUESTED', `quotation:${ctx.request.id}:ANOTHER_QUOTE_REQUESTED:${after.sendCount}`, note);
  }

  /** The decision was made (it may still need approval): finance's "ready" ping is done. */
  async awardProposed(ctx: CommandContext) {
    await this.resolve(ctx, ['QUOTES_READY']);
  }

  /** The proposal was withdrawn: the request is back in finance's queue for this send cycle. */
  async awardWithdrawn(ctx: CommandContext) {
    await this.toSelectors(ctx, `quotation:${ctx.request.id}:QUOTES_READY:${ctx.request.sendCount}`);
  }

  async awarded(ctx: CommandContext) {
    await this.resolve(ctx, ['QUOTES_READY']);
    await this.toCollectors(ctx, 'QUOTATION_AWARDED', `quotation:${ctx.request.id}:QUOTATION_AWARDED:${ctx.request.sendCount}`);
  }

  async orderRaised(ctx: CommandContext) {
    await this.resolve(ctx, ['QUOTATION_AWARDED']);
  }

  /** Re-notify the selectors with a fresh row (a re-decision is a new demand on them). */
  async redecisionRequested(ctx: CommandContext, after: NotifiedRequest) {
    await this.resolve(ctx, ['QUOTATION_AWARDED', 'QUOTES_READY']);
    await this.toSelectors(
      ctx,
      `quotation:${ctx.request.id}:QUOTES_READY:${after.sendCount}:redecision:${after.updatedAt.getTime()}`,
    );
  }

  async cancelled(ctx: CommandContext) {
    await this.resolve(ctx, ALL_KINDS);
  }

  /**
   * Active org members holding award:quotation through an active role, minus anyone the
   * SELECT_QUOTATION SoD bars on this request (they could not act on the notification).
   */
  async selectorIds(ctx: CommandContext): Promise<string[]> {
    const [action, resource] = PERMISSIONS.quotationsAward.split(':');
    const memberships = await ctx.tx.organizationMembership.findMany({
      where: {
        organizationId: ctx.request.organizationId,
        status: 'ACTIVE',
        removedAt: null,
        user: { status: 'ACTIVE' },
        roles: {
          some: {
            removedAt: null,
            role: { rolePermissions: { some: { permission: { action, resource } } } },
          },
        },
      },
      select: { userId: true },
    });
    const codes = await this.sod.activeRuleCodes(ctx.request.organizationId);
    const eligible: string[] = [];
    for (const { userId } of memberships) {
      const barred = await this.access.selectionBarredBy(
        ctx.request.organizationId,
        userId,
        ctx.request,
        ctx.mr.requestedBy,
        codes,
      );
      if (!barred) eligible.push(userId);
    }
    return [...new Set(eligible)];
  }

  /** The request's creator and every quote/photo uploader. */
  collectorIds(ctx: CommandContext): string[] {
    return this.access.evidenceTouchers(ctx.request);
  }

  private async toSelectors(ctx: CommandContext, dedupeKey: string) {
    const recipients = await this.selectorIds(ctx);
    const context = await this.context(ctx);
    await this.writer.upsertMany(
      ctx.tx,
      recipients.map((recipientUserId) => this.row(ctx, recipientUserId, 'QUOTES_READY', dedupeKey, context, `/finance/quotes/${ctx.request.id}`)),
    );
  }

  private async toCollectors(ctx: CommandContext, kind: NotificationKind, dedupeKey: string, note?: string) {
    const context = await this.context(ctx, note);
    await this.writer.upsertMany(
      ctx.tx,
      this.collectorIds(ctx).map((recipientUserId) =>
        this.row(ctx, recipientUserId, kind, dedupeKey, context, `/procurement/quotes/${ctx.request.id}`),
      ),
    );
  }

  private row(
    ctx: CommandContext,
    recipientUserId: string,
    kind: NotificationKind,
    dedupeKey: string,
    contextData: QuotationNotificationContext,
    actionUrl: string,
  ) {
    return {
      organizationId: ctx.request.organizationId,
      recipientUserId,
      kind,
      dedupeKey,
      projectId: ctx.request.projectId,
      resourceType: RESOURCE_TYPE,
      resourceId: ctx.request.id,
      contextData: contextData as unknown as Record<string, string | number>,
      actionUrl,
    };
  }

  /** `{ number, mrNumber, projectName?, quoteCount, note? }` — never an amount. */
  private async context(ctx: CommandContext, note?: string): Promise<QuotationNotificationContext> {
    const project = ctx.request.projectId
      ? await ctx.tx.project.findUnique({ where: { id: ctx.request.projectId }, select: { name: true } })
      : null;
    const quoteCount = await ctx.tx.quote.count({ where: { quotationRequestId: ctx.request.id, status: 'ACTIVE' } });
    return {
      number: ctx.request.number,
      mrNumber: ctx.mr.mrNumber,
      ...(project ? { projectName: project.name } : {}),
      quoteCount,
      ...(note ? { note } : {}),
    };
  }

  private resolve(ctx: CommandContext, kinds: NotificationKind[]) {
    return this.writer.resolve(ctx.tx, {
      organizationId: ctx.request.organizationId,
      resourceType: RESOURCE_TYPE,
      resourceId: ctx.request.id,
      kinds,
    });
  }
}
