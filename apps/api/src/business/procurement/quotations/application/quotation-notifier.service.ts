import { Injectable } from '@nestjs/common';
import type { NotificationKind, QuotationNotificationContext } from '@erp/types';
import { PERMISSIONS } from '@erp/types';

import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';
import { NotificationWriter } from '../../../../platform/notifications/application/notification-writer.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { QuotationAccessService } from './quotation-access.service.js';
import type { CommandContext } from './quotation-command-runner.service.js';
import { QuotationWhatsAppAlerts } from './quotation-whatsapp-alerts.service.js';
import { awardRound, decisionRound, type QuotationAlertFacts } from '../domain/quotation-whatsapp.policy.js';
import type { Db, QuotationRequestAggregate } from '../infrastructure/quotation-request.repository.js';

const RESOURCE_TYPE = 'QuotationRequest';
const ALL_KINDS: NotificationKind[] = ['QUOTES_READY', 'QUOTATION_AWARDED', 'ANOTHER_QUOTE_REQUESTED'];
/** ADR-044 §10 — the SLA escalation goes to the holders of these roles (friendly Role.name). */
const ESCALATION_ROLE_NAMES = ['CFO', 'CEO'];

/** The request state an event is announced from (after the command's write). */
export interface NotifiedRequest {
  sendCount: number;
  sentAt: Date | null;
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
 *
 * ADR-044 phase 2 — the same events also queue WhatsApp alerts (QuotationWhatsAppAlerts) to the
 * same recipients who opted in: send / re-decision → QUOTE_READY, award → QUOTE_CHOSEN,
 * ask-another → QUOTE_ANOTHER. Queued in this transaction; sent later by the dispatcher.
 */
@Injectable()
export class QuotationNotifier {
  constructor(
    private readonly writer: NotificationWriter,
    private readonly access: QuotationAccessService,
    private readonly sod: SegregationOfDutiesService,
    private readonly projectAccess: ProjectAccessService,
    private readonly whatsapp: QuotationWhatsAppAlerts,
  ) {}

  async sent(ctx: CommandContext, after: NotifiedRequest) {
    await this.resolve(ctx, ['ANOTHER_QUOTE_REQUESTED']);
    const recipients = await this.toSelectors(ctx, `quotation:${ctx.request.id}:QUOTES_READY:${after.sendCount}`);
    await this.alertSelectors(ctx, recipients, decisionRound(after));
  }

  async reopened(ctx: CommandContext) {
    await this.resolve(ctx, ['QUOTES_READY']);
  }

  async returned(ctx: CommandContext, after: NotifiedRequest, note: string) {
    await this.resolve(ctx, ['QUOTES_READY']);
    await this.toCollectors(ctx, 'ANOTHER_QUOTE_REQUESTED', `quotation:${ctx.request.id}:ANOTHER_QUOTE_REQUESTED:${after.sendCount}`, note);
    await this.whatsapp.queue(ctx.tx, {
      organizationId: ctx.request.organizationId,
      requestId: ctx.request.id,
      purpose: 'QUOTE_ANOTHER',
      round: String(after.sendCount),
      recipientUserIds: this.collectorIds(ctx),
      facts: async () => ({ ...(await this.alertFacts(ctx.tx, ctx.request, ctx.mr.mrNumber)), note }),
      actorUserId: ctx.identity.userId,
    });
  }

  /** The decision was made (it may still need approval): finance's "ready" ping is done. */
  async awardProposed(ctx: CommandContext) {
    await this.resolve(ctx, ['QUOTES_READY']);
  }

  /** The proposal was withdrawn: the request is back in finance's queue for this send cycle. */
  async awardWithdrawn(ctx: CommandContext) {
    const recipients = await this.toSelectors(ctx, `quotation:${ctx.request.id}:QUOTES_READY:${ctx.request.sendCount}`);
    // Same round as the original send: anyone already alerted is not alerted again.
    await this.alertSelectors(ctx, recipients, decisionRound(ctx.request));
  }

  async awarded(ctx: CommandContext) {
    await this.resolve(ctx, ['QUOTES_READY']);
    await this.toCollectors(ctx, 'QUOTATION_AWARDED', `quotation:${ctx.request.id}:QUOTATION_AWARDED:${ctx.request.sendCount}`);
    // The award was just written in this transaction: read the chosen store and payment path back —
    // lazily, inside the alert's savepoint and only when alerts are on (review L1).
    let read: Promise<{
      awardedAt: Date | null;
      awardedQuoteId: string | null;
      paymentPath: 'BUYER_CASH' | 'FINANCE_PAYS_SUPPLIER' | null;
      awardedSupplier: { name: string } | null;
    }> | null = null;
    const award = () =>
      (read ??= ctx.tx.quotationRequest.findUniqueOrThrow({
        where: { id: ctx.request.id },
        select: { awardedAt: true, awardedQuoteId: true, paymentPath: true, awardedSupplier: { select: { name: true } } },
      }));
    await this.whatsapp.queue(ctx.tx, {
      organizationId: ctx.request.organizationId,
      requestId: ctx.request.id,
      purpose: 'QUOTE_CHOSEN',
      // A re-decision can award again in the same send round: the award instant is the round.
      round: async () => awardRound({ awardedAt: (await award()).awardedAt, sendCount: ctx.request.sendCount }),
      recipientUserIds: this.collectorIds(ctx),
      facts: async () => {
        const chosen = await award();
        const quote = ctx.request.quotes.find((q) => q.id === chosen.awardedQuoteId);
        return {
          ...(await this.alertFacts(ctx.tx, ctx.request, ctx.mr.mrNumber)),
          storeName: chosen.awardedSupplier?.name ?? quote?.supplier?.name ?? quote?.storeName ?? null,
          paymentPath: chosen.paymentPath,
        };
      },
      actorUserId: ctx.identity.userId,
    });
  }

  async orderRaised(ctx: CommandContext) {
    await this.resolve(ctx, ['QUOTATION_AWARDED']);
  }

  /** Re-notify the selectors with a fresh row (a re-decision is a new demand on them). */
  async redecisionRequested(ctx: CommandContext, after: NotifiedRequest) {
    await this.resolve(ctx, ['QUOTATION_AWARDED', 'QUOTES_READY']);
    const recipients = await this.toSelectors(
      ctx,
      `quotation:${ctx.request.id}:QUOTES_READY:${after.sendCount}:redecision:${after.updatedAt.getTime()}`,
    );
    // A re-decision restarts the clock (new sentAt): a new round of ready / reminder / escalation.
    await this.alertSelectors(ctx, recipients, decisionRound(after));
  }

  async cancelled(ctx: CommandContext) {
    await this.resolve(ctx, ALL_KINDS);
  }

  /**
   * Active org members holding award:quotation through an active role who can reach the request's
   * project, minus anyone the SELECT_QUOTATION SoD bars on this request (they could not act on it).
   */
  async selectorIds(ctx: CommandContext): Promise<string[]> {
    return this.selectorIdsFor(ctx.tx, ctx.request, ctx.mr.requestedBy);
  }

  /** `selectorIds` outside a command (the SLA job): the request and its MR's requester. */
  async selectorIdsFor(tx: Db, request: QuotationRequestAggregate, mrRequestedBy: string): Promise<string[]> {
    const ctx = { tx, request, mr: { requestedBy: mrRequestedBy } };
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
    // Review M3: a project's quotation pings only those who can open it (members or bypass roles).
    const reachable = ctx.request.projectId
      ? await this.projectAccess.usersWithAccess(
          ctx.request.organizationId,
          ctx.request.projectId,
          memberships.map((m) => m.userId),
        )
      : null;
    const codes = await this.sod.activeRuleCodes(ctx.request.organizationId);
    const eligible: string[] = [];
    for (const { userId } of memberships) {
      if (reachable && !reachable.has(userId)) continue;
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
    return this.collectorIdsFor(ctx.request);
  }

  collectorIdsFor(request: QuotationRequestAggregate): string[] {
    return this.access.evidenceTouchers(request);
  }

  /**
   * Active org members holding a role named CFO or CEO who can reach the request's project — the
   * SLA escalation audience (ADR-044 §10). Role names, as the project-access bypass list uses.
   */
  async escalationIdsFor(tx: Db, request: { organizationId: string; projectId: string | null }): Promise<string[]> {
    const memberships = await tx.organizationMembership.findMany({
      where: {
        organizationId: request.organizationId,
        status: 'ACTIVE',
        removedAt: null,
        user: { status: 'ACTIVE' },
        roles: { some: { removedAt: null, role: { name: { in: ESCALATION_ROLE_NAMES } } } },
      },
      select: { userId: true },
    });
    const ids = [...new Set(memberships.map((m) => m.userId))];
    if (!request.projectId) return ids;
    const reachable = await this.projectAccess.usersWithAccess(request.organizationId, request.projectId, ids);
    return ids.filter((id) => reachable.has(id));
  }

  /** `{ number, mrNumber, projectName, quoteCount }` for the WhatsApp templates — never an amount. */
  async alertFacts(tx: Db, request: QuotationRequestAggregate, mrNumber: string): Promise<QuotationAlertFacts> {
    const project = request.projectId
      ? await tx.project.findUnique({ where: { id: request.projectId }, select: { name: true } })
      : null;
    const quoteCount = await tx.quote.count({ where: { quotationRequestId: request.id, status: 'ACTIVE' } });
    return { number: request.number, mrNumber, projectName: project?.name ?? null, quoteCount };
  }

  private async alertSelectors(ctx: CommandContext, recipients: string[], round: string) {
    await this.whatsapp.queue(ctx.tx, {
      organizationId: ctx.request.organizationId,
      requestId: ctx.request.id,
      purpose: 'QUOTE_READY',
      round,
      recipientUserIds: recipients,
      facts: () => this.alertFacts(ctx.tx, ctx.request, ctx.mr.mrNumber),
      actorUserId: ctx.identity.userId,
    });
  }

  private async toSelectors(ctx: CommandContext, dedupeKey: string): Promise<string[]> {
    const recipients = await this.selectorIds(ctx);
    const context = await this.context(ctx);
    await this.writer.upsertMany(
      ctx.tx,
      recipients.map((recipientUserId) => this.row(ctx, recipientUserId, 'QUOTES_READY', dedupeKey, context, `/finance/quotes/${ctx.request.id}`)),
    );
    return recipients;
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
