import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { NotificationKind, QuotationNotificationContext } from '@erp/types';
import { PERMISSIONS } from '@erp/types';

import { NotificationWriter } from '../../../../platform/notifications/application/notification-writer.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { PurchaseOrderService } from '../../purchase-orders/application/purchase-order.service.js';
import type { AwardPaymentEvents } from '../../../accounting/accounts-payable/domain/award-payment-events.port.js';
import { QuotationRequestRepository, type Db } from '../infrastructure/quotation-request.repository.js';
import { QuotationAccessService } from './quotation-access.service.js';
import { QuotationWhatsAppAlerts } from './quotation-whatsapp-alerts.service.js';

const REQUEST_RESOURCE = 'QuotationRequest';
const STORE_DOCUMENT_RESOURCE = 'StoreDocument';

export interface StoreDocumentRef {
  id: string;
  number: string;
  organizationId: string;
  purchaseOrderId: string;
  quotationRequestId: string | null;
  uploadedBy: string;
}

/**
 * ADR-045 §5 — who hears about paying from an award, written in the command's own transaction
 * (NotificationWriter) with the WhatsApp alert queued under a SAVEPOINT (QuotationWhatsAppAlerts,
 * kill switch QUOTATION_WHATSAPP_ENABLED). Never an amount — in the text or the context.
 *
 * | Kind / purpose                       | When                          | To                                   | Resolved by                      |
 * |--------------------------------------|-------------------------------|--------------------------------------|----------------------------------|
 * | PAYMENT_NEEDED / QUOTE_PAY_NEEDED    | award PO confirmed (covered)  | manage:payable holders with project  | first cash release / payment;    |
 * |                                      |                               | access, minus the request creator    | path change (re-targeted); cancel|
 * | CASH_RELEASED / QUOTE_CASH_RELEASED  | buyer advance posted          | the advance recipient                | —                                |
 * | SUPPLIER_PAID / QUOTE_SUPPLIER_PAID  | award supplier payment posted | the request creator + uploaders      | —                                |
 * | RECEIPT_TO_RECORD (in-app)           | store document submitted      | manage:payable holders (as above)    | recorded / rejected / withdrawn  |
 * | RECEIPT_REJECTED (in-app)            | store document rejected       | its uploader                         | —                                |
 *
 * Also the AP events port (AWARD_PAYMENT_EVENTS) and the PO "covered confirm" hook.
 */
@Injectable()
export class QuotationPaymentNotifier implements AwardPaymentEvents, OnModuleInit {
  constructor(
    private readonly writer: NotificationWriter,
    private readonly access: QuotationAccessService,
    private readonly projectAccess: ProjectAccessService,
    private readonly whatsapp: QuotationWhatsAppAlerts,
    private readonly repo: QuotationRequestRepository,
    private readonly purchaseOrders: PurchaseOrderService,
  ) {}

  onModuleInit(): void {
    this.purchaseOrders.registerCoveredConfirmHook((tx, ctx) =>
      this.paymentNeeded(tx, {
        organizationId: ctx.identity.activeOrganizationId,
        quotationRequestId: ctx.quotationRequestId,
        actorUserId: ctx.identity.userId,
      }),
    );
  }

  // ── PAYMENT_NEEDED ────────────────────────────────────────────────────────────────────────────

  /** S1 — the award's order was issued: the payers are asked to pay along the recorded path. */
  async paymentNeeded(tx: Db, e: { organizationId: string; quotationRequestId: string; actorUserId: string }) {
    const facts = await this.facts(tx, e.organizationId, e.quotationRequestId);
    if (!facts || !facts.purchaseOrderId || !facts.paymentPath) return;
    const recipients = await this.payerIdsFor(tx, facts);
    const round = `${facts.purchaseOrderId}.${facts.paymentPath}`;
    await this.writer.upsertMany(
      tx as never,
      recipients.map((userId) =>
        this.row(facts, userId, 'PAYMENT_NEEDED', `quotation:${facts.id}:PAYMENT_NEEDED:${round}`, `/finance/quotes/${facts.id}`, REQUEST_RESOURCE, facts.id),
      ),
    );
    await this.whatsapp.queue(tx as never, {
      organizationId: facts.organizationId,
      requestId: facts.id,
      purpose: 'QUOTE_PAY_NEEDED',
      round,
      recipientUserIds: recipients,
      facts: () => this.alertFacts(facts),
      actorUserId: e.actorUserId,
    });
  }

  /** The payment path changed: the old ask is resolved and a new one (new path) is raised. */
  async paymentPathChanged(tx: Db, e: { organizationId: string; quotationRequestId: string; actorUserId: string }) {
    await this.resolve(tx, e.organizationId, REQUEST_RESOURCE, e.quotationRequestId, ['PAYMENT_NEEDED']);
    await this.paymentNeeded(tx, e);
  }

  // ── AWARD_PAYMENT_EVENTS (called by Accounts Payable) ────────────────────────────────────────

  async cashReleased(
    tx: Db,
    e: { organizationId: string; quotationRequestId: string; advanceId: string; recipientUserId: string; actorUserId: string },
  ) {
    await this.resolve(tx, e.organizationId, REQUEST_RESOURCE, e.quotationRequestId, ['PAYMENT_NEEDED']);
    const facts = await this.facts(tx, e.organizationId, e.quotationRequestId);
    if (!facts) return;
    await this.writer.upsertMany(tx as never, [
      this.row(
        facts,
        e.recipientUserId,
        'CASH_RELEASED',
        `quotation:${facts.id}:CASH_RELEASED:${e.advanceId}`,
        `/procurement/quotes/${facts.id}`,
        REQUEST_RESOURCE,
        facts.id,
      ),
    ]);
    await this.whatsapp.queue(tx as never, {
      organizationId: facts.organizationId,
      requestId: facts.id,
      purpose: 'QUOTE_CASH_RELEASED',
      round: e.advanceId,
      recipientUserIds: [e.recipientUserId],
      facts: () => this.alertFacts(facts),
      actorUserId: e.actorUserId,
    });
  }

  async supplierPaid(tx: Db, e: { organizationId: string; quotationRequestId: string; paymentId: string; actorUserId: string }) {
    await this.resolve(tx, e.organizationId, REQUEST_RESOURCE, e.quotationRequestId, ['PAYMENT_NEEDED']);
    const facts = await this.facts(tx, e.organizationId, e.quotationRequestId);
    if (!facts) return;
    const recipients = facts.collectorIds;
    await this.writer.upsertMany(
      tx as never,
      recipients.map((userId) =>
        this.row(facts, userId, 'SUPPLIER_PAID', `quotation:${facts.id}:SUPPLIER_PAID:${e.paymentId}`, `/procurement/quotes/${facts.id}`, REQUEST_RESOURCE, facts.id),
      ),
    );
    await this.whatsapp.queue(tx as never, {
      organizationId: facts.organizationId,
      requestId: facts.id,
      purpose: 'QUOTE_SUPPLIER_PAID',
      round: e.paymentId,
      recipientUserIds: recipients,
      facts: () => this.alertFacts(facts),
      actorUserId: e.actorUserId,
    });
  }

  async receiptRecorded(tx: Db, e: { organizationId: string; storeDocumentId: string }) {
    await this.resolve(tx, e.organizationId, STORE_DOCUMENT_RESOURCE, e.storeDocumentId, ['RECEIPT_TO_RECORD']);
  }

  // ── Store documents ───────────────────────────────────────────────────────────────────────────

  /** S4 — a receipt to record (in-app only): the payers. */
  async receiptSubmitted(tx: Db, doc: StoreDocumentRef) {
    if (!doc.quotationRequestId) return;
    const facts = await this.facts(tx, doc.organizationId, doc.quotationRequestId);
    if (!facts) return;
    const recipients = await this.payerIdsFor(tx, facts, { excludeCreator: false });
    await this.writer.upsertMany(
      tx as never,
      recipients
        .filter((id) => id !== doc.uploadedBy)
        .map((userId) => ({
          ...this.row(facts, userId, 'RECEIPT_TO_RECORD', `store-document:${doc.id}:RECEIPT_TO_RECORD`, `/finance/quotes/${facts.id}`, STORE_DOCUMENT_RESOURCE, doc.id),
          contextData: { ...this.context(facts), storeDocumentNumber: doc.number } as unknown as Record<string, string | number>,
        })),
    );
  }

  async receiptWithdrawn(tx: Db, doc: StoreDocumentRef) {
    await this.resolve(tx, doc.organizationId, STORE_DOCUMENT_RESOURCE, doc.id, ['RECEIPT_TO_RECORD']);
  }

  /** The receipt was refused: finance's ask is resolved and the uploader is told why (in-app). */
  async receiptRejected(tx: Db, doc: StoreDocumentRef, reason: string) {
    await this.resolve(tx, doc.organizationId, STORE_DOCUMENT_RESOURCE, doc.id, ['RECEIPT_TO_RECORD']);
    if (!doc.quotationRequestId) return;
    const facts = await this.facts(tx, doc.organizationId, doc.quotationRequestId);
    if (!facts) return;
    await this.writer.upsertMany(tx as never, [
      {
        ...this.row(facts, doc.uploadedBy, 'RECEIPT_REJECTED', `store-document:${doc.id}:RECEIPT_REJECTED`, `/procurement/quotes/${facts.id}`, STORE_DOCUMENT_RESOURCE, doc.id),
        contextData: { ...this.context(facts), storeDocumentNumber: doc.number, rejectReason: reason } as unknown as Record<string, string | number>,
      },
    ]);
  }

  // ── Audiences (also used by the dispatch guard) ──────────────────────────────────────────────

  /**
   * ACTIVE org members holding manage:payable through an active role who can reach the request's
   * project; minus the request creator (the buyer-to-be cannot pay themselves) unless told otherwise.
   */
  async payerIdsFor(
    db: Db,
    request: { organizationId: string; projectId: string | null; createdBy: string },
    opts: { excludeCreator?: boolean } = {},
  ): Promise<string[]> {
    const [action, resource] = PERMISSIONS.payablesManage.split(':');
    const memberships = await db.organizationMembership.findMany({
      where: {
        organizationId: request.organizationId,
        status: 'ACTIVE',
        removedAt: null,
        user: { status: 'ACTIVE' },
        roles: { some: { removedAt: null, role: { rolePermissions: { some: { permission: { action, resource } } } } } },
      },
      select: { userId: true },
    });
    let ids = [...new Set(memberships.map((m) => m.userId))];
    if (opts.excludeCreator !== false) ids = ids.filter((id) => id !== request.createdBy);
    if (!request.projectId) return ids;
    const reachable = await this.projectAccess.usersWithAccess(request.organizationId, request.projectId, ids);
    return ids.filter((id) => reachable.has(id));
  }

  // ── helpers ───────────────────────────────────────────────────────────────────────────────────

  private async facts(db: Db, organizationId: string, requestId: string) {
    const request = await this.repo.findById(db, organizationId, requestId);
    if (!request) return null;
    const [mr, po, project, supplier] = await Promise.all([
      db.materialRequest.findUnique({ where: { id: request.materialRequestId }, select: { mrNumber: true } }),
      request.purchaseOrderId
        ? db.purchaseOrder.findUnique({ where: { id: request.purchaseOrderId }, select: { poNumber: true } })
        : Promise.resolve(null),
      request.projectId ? db.project.findUnique({ where: { id: request.projectId }, select: { name: true } }) : Promise.resolve(null),
      request.awardedSupplierId
        ? db.supplier.findUnique({ where: { id: request.awardedSupplierId }, select: { name: true } })
        : Promise.resolve(null),
    ]);
    return {
      id: request.id,
      organizationId: request.organizationId,
      number: request.number,
      projectId: request.projectId,
      createdBy: request.createdBy,
      purchaseOrderId: request.purchaseOrderId,
      paymentPath: request.paymentPath,
      mrNumber: mr?.mrNumber ?? '',
      poNumber: po?.poNumber ?? null,
      projectName: project?.name ?? null,
      storeName: supplier?.name ?? null,
      quoteCount: request.quotes.filter((q) => q.status === 'ACTIVE').length,
      collectorIds: this.access.evidenceTouchers(request),
    };
  }

  private context(f: NonNullable<Awaited<ReturnType<QuotationPaymentNotifier['facts']>>>): QuotationNotificationContext {
    return {
      number: f.number,
      mrNumber: f.mrNumber,
      ...(f.projectName ? { projectName: f.projectName } : {}),
      quoteCount: f.quoteCount,
      ...(f.poNumber ? { poNumber: f.poNumber } : {}),
      ...(f.storeName ? { storeName: f.storeName } : {}),
      ...(f.paymentPath ? { paymentPath: f.paymentPath } : {}),
    };
  }

  private alertFacts(f: NonNullable<Awaited<ReturnType<QuotationPaymentNotifier['facts']>>>) {
    return Promise.resolve({
      number: f.number,
      mrNumber: f.mrNumber,
      projectName: f.projectName,
      storeName: f.storeName,
      poNumber: f.poNumber,
      paymentPath: f.paymentPath,
    });
  }

  private row(
    f: NonNullable<Awaited<ReturnType<QuotationPaymentNotifier['facts']>>>,
    recipientUserId: string,
    kind: NotificationKind,
    dedupeKey: string,
    actionUrl: string,
    resourceType: string,
    resourceId: string,
  ) {
    return {
      organizationId: f.organizationId,
      recipientUserId,
      kind,
      dedupeKey,
      projectId: f.projectId,
      resourceType,
      resourceId,
      contextData: this.context(f) as unknown as Record<string, string | number>,
      actionUrl,
    };
  }

  private resolve(db: Db, organizationId: string, resourceType: string, resourceId: string, kinds: NotificationKind[]) {
    return this.writer.resolve(db as never, { organizationId, resourceType, resourceId, kinds });
  }
}
