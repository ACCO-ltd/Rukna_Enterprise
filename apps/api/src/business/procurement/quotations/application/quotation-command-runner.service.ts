import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { quotationConflict } from '../domain/quotation-errors.js';
import type {
  CallerFacts,
  LinkedPurchaseOrderFacts,
  QuotationAction,
  QuotationFacts,
  QuotationStatus,
} from '../domain/quotation-state.policy.js';
import {
  QuotationRequestRepository,
  type MaterialRequestForQuotation,
  type QuotationRequestAggregate,
} from '../infrastructure/quotation-request.repository.js';
import { QuotationAccessService } from './quotation-access.service.js';

export interface CommandContext {
  tx: Prisma.TransactionClient;
  identity: RequestIdentity;
  request: QuotationRequestAggregate;
  mr: MaterialRequestForQuotation;
  linkedPo: LinkedPurchaseOrderFacts | null;
  caller: CallerFacts;
  facts: QuotationFacts;
}

export interface AuditEvent {
  eventType: string;
  sourceCommand: string;
  action?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  approvalInstanceId?: string;
  /** Distinguishes several events of one type in one command (e.g. a quote id). */
  keySuffix?: string;
}

/**
 * The skeleton every quotation command shares (ADR-044 §3): org-scoped load (404 for a foreign id),
 * project access, one transaction holding the request's row lock, the state-policy check, then the
 * command's own writes and its audit-outbox event — all-or-nothing.
 */
@Injectable()
export class QuotationCommandRunner {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: QuotationRequestRepository,
    private readonly access: QuotationAccessService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  /**
   * Runs `body` under the request's lock. `action` is checked against the state policy first,
   * unless `alreadyDone` answers true (an idempotent replay: nothing is written, undefined returned).
   */
  async run<R>(
    identity: RequestIdentity,
    id: string,
    action: QuotationAction,
    body: (ctx: CommandContext) => Promise<R>,
    alreadyDone?: (ctx: CommandContext) => Promise<boolean>,
  ): Promise<R | undefined> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const found = await this.repo.findById(prisma, orgId, id);
    if (!found) throw new NotFoundException(`Quotation request ${id} not found`);
    await this.access.assertProjectAccess(identity, found);

    return prisma.$transaction(async (tx) => {
      const ctx = await this.context(tx, identity, id);
      if (alreadyDone && (await alreadyDone(ctx))) return undefined;
      this.access.assertAvailable(action, ctx.facts, ctx.caller);
      return body(ctx);
    });
  }

  /** Locks the request and loads what the policy needs, inside `tx`. */
  async context(tx: Prisma.TransactionClient, identity: RequestIdentity, id: string): Promise<CommandContext> {
    const orgId = identity.activeOrganizationId;
    const request = await this.repo.lockById(tx, orgId, id);
    if (!request) throw new NotFoundException(`Quotation request ${id} not found`);
    const [mr, linkedPo] = await Promise.all([
      this.repo.findMaterialRequest(tx, orgId, request.materialRequestId),
      this.repo.linkedPurchaseOrder(tx, request.purchaseOrderId),
    ]);
    if (!mr) throw new NotFoundException(`Material request ${request.materialRequestId} not found`);
    const caller = await this.access.callerFacts(identity, request, mr.requestedBy);
    return { tx, identity, request, mr, linkedPo, caller, facts: this.access.facts(request, linkedPo) };
  }

  /**
   * Compare-and-set write on the request (status must still be `from`); returns the new row. Under
   * the row lock this cannot lose, but it keeps the "never overwrite a concurrent change" rule
   * explicit. Every command writes the request, so `updatedAt` moves and the audit key is unique
   * per occurrence (repeated cycles must not collide on the outbox's unique key).
   */
  async writeRequest(
    ctx: CommandContext,
    from: QuotationStatus,
    data: Prisma.QuotationRequestUncheckedUpdateManyInput,
  ) {
    const { count } = await ctx.tx.quotationRequest.updateMany({
      where: { id: ctx.request.id, organizationId: ctx.request.organizationId, status: from },
      data: { ...data, updatedAt: new Date() },
    });
    if (count !== 1) throw quotationConflict('QUOTATION_CHANGED');
    return ctx.tx.quotationRequest.findUniqueOrThrow({ where: { id: ctx.request.id } });
  }

  audit(ctx: CommandContext, updatedAt: Date, event: AuditEvent): Promise<void> {
    const suffix = event.keySuffix ? `-${event.keySuffix}` : '';
    return this.auditOutbox.record(ctx.tx, {
      organizationId: ctx.request.organizationId,
      actorUserId: ctx.identity.userId,
      action: event.action ?? 'TRANSITION',
      resourceType: 'QuotationRequest',
      resourceId: ctx.request.id,
      sourceCommand: event.sourceCommand,
      eventType: event.eventType,
      idempotencyKey: `quotation-${ctx.request.id}-${event.eventType}${suffix}-${updatedAt.getTime()}`,
      before: event.before,
      after: { number: ctx.request.number, ...(event.after ?? {}) },
      reason: event.reason,
      approvalInstanceId: event.approvalInstanceId,
    });
  }
}
