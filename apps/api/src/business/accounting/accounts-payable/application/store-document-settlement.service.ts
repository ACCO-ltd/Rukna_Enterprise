import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { PurchaseOrderService } from '../../../procurement/purchase-orders/application/purchase-order.service.js';
import { AwardPaymentRepository } from '../infrastructure/award-payment.repository.js';
import { SupplierBillRepository } from '../infrastructure/supplier-bill.repository.js';
import { splitReceiptTotal } from '../domain/award-payment.policy.js';
import { parseDateOnly, parseMoney, paymentConflict, paymentUnprocessable } from '../domain/payment-errors.js';
import { AWARD_PAYMENT_EVENTS, type AwardPaymentEvents } from '../domain/award-payment-events.port.js';
import { SupplierBillService } from './supplier-bill.service.js';
import { SupplierPaymentService } from './supplier-payment.service.js';
import { BuyerAdvanceService } from './buyer-advance.service.js';

export interface RecordStoreDocumentCommand {
  storeDocumentId: string;
  /** The receipt total finance reads from the photo (required to create the bill; ignored on resume). */
  total?: string | number;
  /** The receipt date finance confirms — the bill date (the accounting date of EVT-AP-001). */
  documentDate?: string;
  supplierInvoiceNumber?: string;
  expenseProfileCode?: string;
  note?: string;
}

export type RecordStep = 'DONE' | 'MATCH_EXCEPTION' | 'WAITING_APPROVAL';

const ZERO = new Decimal(0);
const dec = (v: { toString(): string } | null | undefined) => new Decimal(v ? v.toString() : 0);

/**
 * ADR-045 §2 settle — "Record receipt": the store document becomes the PO bill, which the buyer's
 * cash (EVT-AP-008) or the supplier prepayment (EVT-AP-005) then settles. In order, resumably:
 *
 *   1. create the PO bill (one line per received, unbilled PO line; the typed total split by PO
 *      value; billDate = the receipt date) and link it to the document — one transaction;
 *   2. submit it (the 3-way match runs; an EXCEPTION stops here → MATCH_EXCEPTION, the existing
 *      exception approval decides: FO ≤ $1k, CFO above);
 *   3. approve (SoD GOODS_RECEIVER_CANNOT_APPROVE_BILL) and post (EVT-AP-001, AP by role);
 *   4. apply: BUYER_CASH → the PO's posted advances oldest first (EVT-AP-008, under the PO and
 *      advance locks); FINANCE_PAYS_SUPPLIER → the PO's posted prepayments (EVT-AP-005);
 *   5. the document RECORDED, its photos IMMUTABLE, RECEIPT_TO_RECORD resolved, the PO auto-closed
 *      when settled.
 *
 * Each step reads state and never repeats a done one: a re-tap (or a retry after a crash between
 * steps) continues from the first unfinished step without a second bill. Steps 2–3 call the
 * existing bill services with their own transactions and gates; no transaction spans steps.
 */
@Injectable()
export class StoreDocumentSettlementService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly awardRepo: AwardPaymentRepository,
    private readonly billRepo: SupplierBillRepository,
    private readonly bills: SupplierBillService,
    private readonly payments: SupplierPaymentService,
    private readonly advances: BuyerAdvanceService,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    @Optional() @Inject(AWARD_PAYMENT_EVENTS) private readonly events?: AwardPaymentEvents,
  ) {}

  async record(identity: RequestIdentity, cmd: RecordStoreDocumentCommand) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    let doc = await prisma.storeDocument.findFirst({ where: { id: cmd.storeDocumentId, organizationId: orgId } });
    if (!doc) throw new NotFoundException(`Store document ${cmd.storeDocumentId} not found`);
    if (doc.status === 'RECORDED') return this.result(identity, doc.id, 'DONE', []);
    if (doc.status !== 'SUBMITTED') throw paymentConflict('STORE_DOCUMENT_NOT_SUBMITTED');

    // Step 1 — the bill (once).
    if (!doc.supplierBillId) {
      await this.createBill(identity, doc.id, cmd);
      doc = await prisma.storeDocument.findUniqueOrThrow({ where: { id: doc.id } });
    }
    const billId = doc.supplierBillId!;

    // Step 2 — submit (auto-match).
    let bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id: billId } });
    if (bill.documentStatus === 'DRAFT') {
      try {
        await this.bills.submit(identity, billId);
      } catch (error) {
        const gate = approvalGate(error);
        if (gate) return this.result(identity, doc.id, 'WAITING_APPROVAL', [], gate);
        throw error;
      }
      bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id: billId } });
    }
    if (bill.documentStatus === 'REJECTED' || bill.documentStatus === 'CANCELLED') {
      throw paymentConflict('STORE_DOCUMENT_NOT_SUBMITTED', {}, `The bill recorded from this receipt was ${bill.documentStatus}.`);
    }
    if (bill.matchStatus === 'EXCEPTION' || bill.matchStatus === 'DISPUTED') {
      return this.result(identity, doc.id, 'MATCH_EXCEPTION', []);
    }

    // Step 3 — approve and post.
    if (bill.documentStatus === 'SUBMITTED') {
      await this.bills.approve(identity, billId);
      bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id: billId } });
    }
    if (bill.postingStatus !== 'POSTED') {
      await this.bills.post(identity, { billId });
      bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id: billId } });
    }

    // Step 4 — settle the bill from what was already paid for this order.
    const applied = await this.applyFunding(identity, doc.purchaseOrderId, billId);

    // Step 5 — recorded.
    await prisma.$transaction(async (tx) => {
      const flipped = await tx.storeDocument.updateMany({
        where: { id: doc!.id, status: 'SUBMITTED' },
        data: { status: 'RECORDED', recordedAt: new Date() },
      });
      if (flipped.count !== 1) return;
      const photos = await tx.storeDocumentPhoto.findMany({ where: { storeDocumentId: doc!.id }, select: { platformFileId: true } });
      await tx.platformFile.updateMany({
        where: { id: { in: photos.map((p) => p.platformFileId) } },
        data: { lifecycle: 'IMMUTABLE', lifecycleReason: `recorded into bill ${bill.billNumber ?? bill.id}`.slice(0, 120) },
      });
      const after = await tx.storeDocument.findUniqueOrThrow({ where: { id: doc!.id } });
      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'TRANSITION',
        resourceType: 'StoreDocument',
        resourceId: doc!.id,
        sourceCommand: 'store-document.record',
        eventType: 'STORE_DOCUMENT_RECORDED',
        idempotencyKey: `store-document-${doc!.id}-STORE_DOCUMENT_RECORDED-${after.updatedAt.getTime()}`,
        before: { status: 'SUBMITTED' },
        after: { status: 'RECORDED', supplierBillId: billId, applied: applied.map((x) => ({ ...x, amount: x.amount })) },
      });
      if (this.events) await this.events.receiptRecorded(tx, { organizationId: orgId, storeDocumentId: doc!.id });
    });
    await this.purchaseOrders.autoCloseIfSettled(identity, doc.purchaseOrderId);
    return this.result(identity, doc.id, 'DONE', applied);
  }

  /** Step 1 — validate, split, create the bill and link it, in one transaction under the locks. */
  private async createBill(identity: RequestIdentity, storeDocumentId: string, cmd: RecordStoreDocumentCommand) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const totalText = parseMoney(cmd.total ?? null);
    if (!totalText) throw paymentUnprocessable('AMOUNT_INVALID');
    const total = new Decimal(totalText);
    const documentDate = parseDateOnly(cmd.documentDate);
    if (!documentDate) throw paymentUnprocessable('DATE_INVALID');
    const profileCode = cmd.expenseProfileCode?.trim();
    if (!profileCode) throw new BadRequestException('expenseProfileCode is required to record a receipt');
    await this.assertExpenseProfile(orgId, profileCode, documentDate);

    await prisma.$transaction(async (tx) => {
      const doc = await tx.storeDocument.findUniqueOrThrow({ where: { id: storeDocumentId } });
      const po = await this.awardRepo.lockPurchaseOrder(tx, orgId, doc.purchaseOrderId);
      if (!po) throw new NotFoundException(`Purchase order ${doc.purchaseOrderId} not found`);
      await tx.$queryRaw`SELECT id FROM store_documents WHERE id = ${storeDocumentId} FOR UPDATE`;
      const current = await tx.storeDocument.findUniqueOrThrow({ where: { id: storeDocumentId } });
      if (current.supplierBillId) return; // a concurrent tap created it
      if (current.status !== 'SUBMITTED') throw paymentConflict('STORE_DOCUMENT_NOT_SUBMITTED');

      const revision = await this.awardRepo.activeRevision(tx, po.id);
      if (!revision) throw paymentConflict('PAYMENT_PO_NOT_OPEN');
      const [accepted, billed] = await Promise.all([
        this.awardRepo.acceptedByPoLine(tx, po.id),
        this.awardRepo.billedByPoLine(tx, po.id),
      ]);
      const billable = revision.lines.map((l) => ({
        line: l,
        quantity: (accepted.get(l.id) ?? ZERO).sub(billed.get(l.id) ?? ZERO),
      }));
      const included = billable.filter((b) => b.quantity.greaterThan(0));
      // R9 — a posted goods receipt must cover the receipt. When only some lines are received, the
      // bill can only match line by line through a unique material; otherwise wait for the rest.
      const materialCount = new Map<string, number>();
      for (const l of revision.lines) if (l.materialId) materialCount.set(l.materialId, (materialCount.get(l.materialId) ?? 0) + 1);
      const uniqueMaterial = (l: (typeof revision.lines)[number]) =>
        l.lineType === 'MATERIAL' && l.materialId !== null && materialCount.get(l.materialId) === 1;
      if (included.length === 0 || (included.length < billable.length && !included.every((b) => uniqueMaterial(b.line)))) {
        throw paymentConflict('GOODS_NOT_RECEIVED');
      }

      const split = splitReceiptTotal(
        total,
        included.map((b) => ({ id: b.line.id, quantity: b.quantity, poUnitPrice: dec(b.line.unitPrice) })),
      );
      const invoiceNumber = cmd.supplierInvoiceNumber?.trim() || current.number;
      const duplicate = await this.billRepo.findBySupplierInvoiceNumber(tx as never, orgId, po.supplierId, invoiceNumber);
      if (duplicate) {
        throw new ConflictException(`Supplier invoice ${invoiceNumber} is already recorded on ${duplicate.billNumber ?? 'a draft bill'}`);
      }
      const request = current.quotationRequestId ? await this.awardRepo.findRequest(tx, orgId, current.quotationRequestId) : null;
      const bill = await this.billRepo.create(tx as never, {
        organizationId: orgId,
        supplierId: po.supplierId,
        supplierInvoiceNumber: invoiceNumber,
        billDate: documentDate,
        // A counter purchase is due when it is bought.
        dueDate: documentDate,
        currencyCode: revision.currencyCode,
        purchaseOrderId: po.id,
        purchaseOrderRevisionId: revision.id,
        projectId: request?.projectId ?? undefined,
        subtotal: total,
        vatAmount: ZERO,
        totalAmount: total,
        createdBy: identity.userId,
        lines: split.map((s, i) => {
          const line = included[i].line;
          return {
            lineNumber: i + 1,
            description: line.description,
            quantity: s.quantity,
            unitPrice: s.unitPrice,
            netAmount: s.amount,
            vatAmount: ZERO,
            grossAmount: s.amount,
            expenseProfileCode: profileCode,
            lineType: line.lineType as 'MATERIAL' | 'SERVICE' | 'OTHER',
            materialId: uniqueMaterial(line) ? line.materialId! : undefined,
            unitOfMeasureId: line.unitOfMeasureId,
            purchaseOrderLineId: line.id,
          };
        }),
      });
      await tx.storeDocument.update({
        where: { id: current.id },
        data: { supplierBillId: bill.id, documentDate, enteredTotal: total, enteredBy: identity.userId },
      });
      const after = await tx.storeDocument.findUniqueOrThrow({ where: { id: current.id } });
      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'TRANSITION',
        resourceType: 'StoreDocument',
        resourceId: current.id,
        sourceCommand: 'store-document.record',
        eventType: 'STORE_DOCUMENT_BILL_CREATED',
        idempotencyKey: `store-document-${current.id}-STORE_DOCUMENT_BILL_CREATED-${after.updatedAt.getTime()}`,
        after: {
          number: current.number,
          supplierBillId: bill.id,
          total: total.toFixed(2),
          documentDate: documentDate.toISOString().slice(0, 10),
          supplierInvoiceNumber: invoiceNumber,
          expenseProfileCode: profileCode,
        },
        reason: cmd.note?.trim() || undefined,
      });
    });
  }

  /**
   * Step 4 — BUYER_CASH: the PO's posted advances, oldest first, while the bill and the advance
   * have outstanding (EVT-AP-008). Otherwise the PO's posted prepayments with an unallocated
   * balance (EVT-AP-005, the existing supplier-advance application).
   */
  private async applyFunding(identity: RequestIdentity, purchaseOrderId: string, billId: string) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const applied: Array<{ kind: 'BUYER_ADVANCE' | 'SUPPLIER_PAYMENT'; id: string; amount: string }> = [];

    const advances = await prisma.buyerAdvance.findMany({
      where: { organizationId: orgId, purchaseOrderId, postingStatus: 'POSTED', postedJournalEntryId: { not: null } },
      orderBy: [{ advancedAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    for (const { id } of advances) {
      const result = await prisma.$transaction(async (tx) => {
        await this.awardRepo.lockPurchaseOrder(tx, orgId, purchaseOrderId);
        await this.awardRepo.lockBuyerAdvance(tx, id);
        const bill = await tx.supplierBill.findUniqueOrThrow({ where: { id: billId }, select: { outstandingAmount: true } });
        if (!dec(bill.outstandingAmount).greaterThan(0)) return null;
        try {
          return await this.advances.applyInTx(tx, identity, id, billId, undefined, 'store-document.record');
        } catch (error) {
          // Nothing left on this advance — try the next one.
          if (isCode(error, 'APPLICATION_EXCEEDS_OUTSTANDING')) return null;
          throw error;
        }
      });
      if (result) applied.push({ kind: 'BUYER_ADVANCE', id, amount: dec(result.application.allocatedAmount).toFixed(2) });
    }

    const prepayments = await prisma.supplierPaymentPurchaseAllocation.findMany({
      where: { organizationId: orgId, purchaseOrderId, supplierPayment: { postingStatus: 'POSTED', unallocatedAmount: { gt: 0 } } },
      orderBy: { allocationDate: 'asc' },
      select: { supplierPaymentId: true },
    });
    for (const { supplierPaymentId } of [...new Map(prepayments.map((p) => [p.supplierPaymentId, p])).values()]) {
      const [bill, payment] = await Promise.all([
        prisma.supplierBill.findUniqueOrThrow({ where: { id: billId }, select: { outstandingAmount: true } }),
        prisma.supplierPayment.findUniqueOrThrow({ where: { id: supplierPaymentId }, select: { unallocatedAmount: true } }),
      ]);
      const room = Decimal.min(dec(bill.outstandingAmount), dec(payment.unallocatedAmount));
      if (!room.greaterThan(0)) continue;
      await this.payments.allocateAdvance(identity, { paymentId: supplierPaymentId, supplierBillId: billId, amount: room.toNumber() });
      applied.push({ kind: 'SUPPLIER_PAYMENT', id: supplierPaymentId, amount: room.toFixed(2) });
    }
    return applied;
  }

  /** The expense profile must exist on the receipt date and point at a cost or expense account. */
  private async assertExpenseProfile(orgId: string, code: string, date: Date) {
    const prisma = this.tenancy.getClient();
    const profile = await prisma.postingProfile.findFirst({ where: { organizationId: orgId, code, status: 'ACTIVE' }, select: { id: true } });
    const version = profile
      ? await prisma.postingProfileVersion.findFirst({
          where: { postingProfileId: profile.id, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }] },
          orderBy: { effectiveFrom: 'desc' },
          select: { accountId: true },
        })
      : null;
    const account = version
      ? await prisma.accountVersion.findFirst({ where: { accountId: version.accountId }, orderBy: { versionNumber: 'desc' }, select: { accountClass: true } })
      : null;
    if (!account || (account.accountClass !== 'COST_OF_SALES' && account.accountClass !== 'EXPENSE')) {
      throw new BadRequestException({
        errorCode: 'POSTING_PROFILE_NOT_EXPENSE',
        message: `Posting profile "${code}" is not a cost or expense profile in force on that date.`,
      });
    }
  }

  private async result(
    identity: RequestIdentity,
    storeDocumentId: string,
    step: RecordStep,
    applied: Array<{ kind: string; id: string; amount: string }>,
    approvalInstanceId?: string,
  ) {
    const prisma = this.tenancy.getClient();
    const doc = await prisma.storeDocument.findUniqueOrThrow({ where: { id: storeDocumentId } });
    const bill = doc.supplierBillId
      ? await prisma.supplierBill.findUnique({
          where: { id: doc.supplierBillId },
          select: {
            id: true,
            billNumber: true,
            supplierInvoiceNumber: true,
            billDate: true,
            totalAmount: true,
            outstandingAmount: true,
            documentStatus: true,
            postingStatus: true,
            matchStatus: true,
          },
        })
      : null;
    return {
      storeDocument: { id: doc.id, number: doc.number, status: doc.status, supplierBillId: doc.supplierBillId },
      bill: bill
        ? { ...bill, totalAmount: dec(bill.totalAmount).toFixed(2), outstandingAmount: dec(bill.outstandingAmount).toFixed(2) }
        : null,
      step,
      applied,
      ...(approvalInstanceId ? { approvalInstanceId } : {}),

    };
  }
}

function approvalGate(error: unknown): string | null {
  const response = (error as { getResponse?: () => unknown }).getResponse?.() as { details?: { approvalInstanceId?: string } } | undefined;
  return response?.details?.approvalInstanceId ?? null;
}

function isCode(error: unknown, code: string): boolean {
  const response = (error as { getResponse?: () => unknown }).getResponse?.() as { details?: { code?: string } } | undefined;
  return response?.details?.code === code;
}
