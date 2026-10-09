import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { quotationBadRequest, quotationConflict } from '../domain/quotation-errors.js';
import { QuotationRequestRepository } from '../infrastructure/quotation-request.repository.js';
import { QuotationAccessService } from './quotation-access.service.js';
import { QuotationPaymentNotifier } from './quotation-payment-notifier.service.js';
import { QuotationPaymentReadModel } from './quotation-payment-read-model.service.js';
import { QuotationQueryService } from './quotation-query.service.js';

/**
 * ADR-045 §4 — `POST /procurement/quotation-requests/:id/payment-path`: the store said "no cash" or
 * "only cash". BUYER_CASH ↔ FINANCE_PAYS_SUPPLIER while no live advance or payment funds the order
 * (409 PAYMENT_PATH_LOCKED otherwise), with a reason; audited; PAYMENT_NEEDED is re-targeted.
 */
@Injectable()
export class QuotationPaymentPathService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: QuotationRequestRepository,
    private readonly access: QuotationAccessService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly notifier: QuotationPaymentNotifier,
    private readonly payments: QuotationPaymentReadModel,
    private readonly query: QuotationQueryService,
  ) {}

  async changePaymentPath(identity: RequestIdentity, id: string, input: { paymentPath: 'BUYER_CASH' | 'FINANCE_PAYS_SUPPLIER'; reason: string }) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const reason = input.reason?.trim();
    if (!reason) throw quotationBadRequest('REASON_REQUIRED', 'Say why the payment path changes (e.g. the store will not take cash).');
    const found = await this.repo.findById(prisma, orgId, id);
    if (!found) throw new NotFoundException(`Quotation request ${id} not found`);
    await this.access.assertProjectAccess(identity, found);

    await prisma.$transaction(async (tx) => {
      const request = await this.repo.lockById(tx, orgId, id);
      if (!request) throw new NotFoundException(`Quotation request ${id} not found`);
      if (request.status !== 'AWARDED') throw quotationConflict('QUOTATION_NOT_AWARDED');
      if (request.paymentPath === input.paymentPath) return; // already so — idempotent
      if (request.purchaseOrderId) {
        await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${request.purchaseOrderId} FOR UPDATE`;
      }
      if (await this.payments.hasLiveFunding(tx, request)) {
        throw quotationConflict(
          'PAYMENT_PATH_LOCKED',
          'Money has already been released or paid for this order, so the payment path cannot change.',
        );
      }
      const { count } = await tx.quotationRequest.updateMany({
        where: { id, organizationId: orgId, status: 'AWARDED', paymentPath: request.paymentPath },
        data: { paymentPath: input.paymentPath, updatedAt: new Date() },
      });
      if (count !== 1) throw quotationConflict('QUOTATION_CHANGED');
      const after = await tx.quotationRequest.findUniqueOrThrow({ where: { id } });
      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'TRANSITION',
        resourceType: 'QuotationRequest',
        resourceId: id,
        sourceCommand: 'quotation.payment-path',
        eventType: 'QUOTATION_PAYMENT_PATH_CHANGED',
        idempotencyKey: `quotation-${id}-QUOTATION_PAYMENT_PATH_CHANGED-${after.updatedAt.getTime()}`,
        before: { paymentPath: request.paymentPath },
        after: { number: request.number, paymentPath: input.paymentPath },
        reason,
      });
      await this.notifier.paymentPathChanged(tx, { organizationId: orgId, quotationRequestId: id, actorUserId: identity.userId });
    });
    return this.query.detail(identity, id);
  }
}
