import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, WorkflowTransactionType, type RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { loadActorNames } from '../../../../platform/users/application/actor-names.js';
import { canSeeQuotationPhotos } from '../../../../platform/files/application/file-authorization.service.js';
import { SettlementQueryService } from '../../purchase-orders/application/settlement-query.service.js';
import { moneyOrNull } from '../../shared/procurement-money.js';
// ADR-045 — the payment arithmetic is Accounts Payable's (pure functions + table reads, no module).
import { AwardPaymentRepository } from '../../../accounting/accounts-payable/infrastructure/award-payment.repository.js';
import { advanceOutstanding, fundingPosition, isLegacyAdvance } from '../../../accounting/accounts-payable/domain/award-payment.policy.js';
import type { AwardPaymentReadModel } from '../../../accounting/accounts-payable/domain/award-payment-events.port.js';
import { paymentState, type PaymentState, type ReceivingStatus } from '../domain/payment-state.policy.js';
import { QuotationRequestRepository, type Db, type QuotationRequestAggregate } from '../infrastructure/quotation-request.repository.js';
import { QuotationAccessService } from './quotation-access.service.js';

export type PaymentAction =
  | 'RELEASE_CASH'
  | 'TOP_UP'
  | 'RECORD_RETURN'
  | 'PAY_SUPPLIER'
  | 'FINISH_PAYMENT'
  | 'PHOTOGRAPH_RECEIPT'
  | 'RECORD_RECEIPT'
  | 'CHANGE_PATH'
  // Review H1 — a posted prepayment not yet applied to the posted bill: apply it, don't pay again.
  | 'APPLY_PREPAYMENT';

const ZERO = new Decimal(0);
const dec = (v: { toString(): string } | null | undefined) => new Decimal(v ? v.toString() : 0);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * ADR-045 §6 — `payment` on the quotation request detail: where paying for the award stands, the
 * money (null unless the caller sees money), the documents, and what the caller can do next.
 * Null while the request is not AWARDED with a recorded path.
 */
@Injectable()
export class QuotationPaymentReadModel implements AwardPaymentReadModel {
  private readonly ap = new AwardPaymentRepository();

  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: QuotationRequestRepository,
    private readonly access: QuotationAccessService,
    private readonly commandGovernance: CommandGovernanceService,
    private readonly settlement: SettlementQueryService,
  ) {}

  async paymentOf(identity: RequestIdentity, quotationRequestId: string) {
    const prisma = this.tenancy.getClient();
    const request = await this.repo.findById(prisma, identity.activeOrganizationId, quotationRequestId);
    return request ? this.build(prisma, identity, request) : null;
  }

  async build(db: Db, identity: RequestIdentity, request: QuotationRequestAggregate) {
    if (request.status !== 'AWARDED' || !request.paymentPath) return null;
    const orgId = request.organizationId;
    const visible = this.access.moneyVisible(identity);
    const money = (d: Decimal | null) => moneyOrNull(visible, d);
    const has = (p: string) => identity.permissions.includes(p);
    const canPay = has(PERMISSIONS.payablesManage);

    const po = request.purchaseOrderId
      ? await db.purchaseOrder.findUnique({ where: { id: request.purchaseOrderId }, select: { id: true, poNumber: true, status: true, supplierId: true } })
      : null;
    const revision = po ? await this.ap.activeRevision(db, po.id) : null;
    const ordered = revision?.ordered ?? ZERO;
    const position = po ? fundingPosition(await this.ap.fundingInputs(db, orgId, po.id, ordered)) : { cap: ZERO, funded: ZERO, remaining: ZERO };

    const [advances, payments, docs] = await Promise.all([
      db.buyerAdvance.findMany({
        where: { organizationId: orgId, purchaseOrderId: po?.id ?? '-' },
        include: { returns: true, evidenceAllocations: true },
        orderBy: [{ advancedAt: 'asc' }, { createdAt: 'asc' }],
      }),
      db.supplierPayment.findMany({
        where: {
          organizationId: orgId,
          OR: [
            { quotationRequestId: request.id },
            ...(po ? [{ purchaseAllocations: { some: { purchaseOrderId: po.id } } }, { allocations: { some: { bill: { purchaseOrderId: po.id } } } }] : []),
          ],
        },
        include: { purchaseAllocations: { select: { purchaseOrderId: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      db.storeDocument.findMany({
        where: { organizationId: orgId, purchaseOrderId: po?.id ?? '-' },
        include: { photos: { orderBy: { pageNumber: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const name = await loadActorNames(db, [...advances.map((a) => a.recipientUserId), ...docs.map((d) => d.uploadedBy)]);
    const advanceRows = advances.map((a) => {
      const legacy = isLegacyAdvance(a);
      const applied = a.evidenceAllocations
        .filter((x) => legacy || x.postingStatus === 'POSTED')
        .reduce((s, x) => s.add(dec(x.allocatedAmount)), ZERO);
      const returned = a.returns.reduce((s, r) => s.add(dec(r.amount)), ZERO);
      const outstanding =
        a.postingStatus === 'POSTED'
          ? advanceOutstanding(
              { amount: dec(a.amount), legacy },
              a.evidenceAllocations.map((x) => ({ amount: dec(x.allocatedAmount), postingStatus: x.postingStatus })),
              a.returns.map((r) => ({ amount: dec(r.amount) })),
            )
          : ZERO;
      return { a, legacy, applied, returned, outstanding };
    });
    const withBuyer = advanceRows.reduce((s, r) => s.add(r.outstanding), ZERO);

    // Approval pending on a draft advance / payment; signatures awaited on an approved payment.
    let approval: { instanceId: string; status: string; currentStepRole: string | null } | null = null;
    for (const id of [...advances.filter((x) => x.documentStatus === 'DRAFT').map((x) => x.id), ...payments.filter((x) => x.documentStatus === 'DRAFT').map((x) => x.id)]) {
      const latest = await this.commandGovernance.latestApproval(WorkflowTransactionType.SUPPLIER_PAYMENT, id);
      if (latest && (latest.status === 'PENDING' || latest.status === 'APPROVED')) {
        approval = { instanceId: latest.id, status: latest.status, currentStepRole: latest.currentStepRole };
        break;
      }
    }
    const unposted = payments.filter((p) => (p.documentStatus === 'APPROVED' || p.documentStatus === 'RELEASED') && p.postingStatus !== 'POSTED');
    let awaitingSignatures = false;
    for (const p of unposted) {
      const signatories = await db.bankAccountSignatory.count({ where: { bankAccountId: p.bankAccountId, isActive: true } });
      if (signatories > 0 && p.documentStatus === 'APPROVED') awaitingSignatures = true;
    }

    let receivingStatus: ReceivingStatus = 'NOT_RECEIVED';
    let settled = false;
    if (po) {
      const s = await this.settlement.getSettlement(identity, po.id);
      receivingStatus = s.receivingStatus;
      settled = s.settlementStatus === 'SETTLED';
    }
    const submitted = docs.filter((d) => d.status === 'SUBMITTED');
    const liveDocs = docs.filter((d) => d.status === 'SUBMITTED' || d.status === 'RECORDED');
    const state: PaymentState = paymentState({
      poStatus: po?.status ?? null,
      settlementSettled: settled,
      pendingApproval: approval?.status === 'PENDING' || approval?.status === 'APPROVED',
      awaitingSignatures,
      fundedPositive: position.funded.greaterThan(0),
      advanceOutstandingPositive: withBuyer.greaterThan(0),
      submittedStoreDocument: submitted.length > 0,
      anyStoreDocument: liveDocs.length > 0,
      receivingStatus,
    });

    const liveFunding = position.funded.greaterThan(0) || advances.some((a) => a.documentStatus === 'DRAFT') || payments.some((p) => p.postingStatus !== 'REVERSED' && p.documentStatus !== 'CANCELLED' && p.documentStatus !== 'REJECTED');
    const supplier = po ? await db.supplier.findUnique({ where: { id: po.supplierId }, select: { createdBy: true } }) : null;
    const isMaintainer = supplier?.createdBy === identity.userId;
    const poOpen = po?.status === 'OPEN';
    const buyerCash = request.paymentPath === 'BUYER_CASH';
    const postedBillOutstanding = po
      ? (await db.supplierBill.aggregate({ where: { purchaseOrderId: po.id, postingStatus: 'POSTED' }, _sum: { outstandingAmount: true } }))._sum.outstandingAmount
      : null;
    const act = (action: PaymentAction, enabled: boolean, reason?: string) => ({ action, enabled, ...(enabled || !reason ? {} : { reason }) });
    const gate = (cond: boolean, reason: string) => (cond ? null : reason);
    const first = (...reasons: Array<string | null>) => reasons.find((r) => r !== null) ?? null;

    const allowedActions = [] as Array<{ action: PaymentAction; enabled: boolean; reason?: string }>;
    if (buyerCash) {
      const hasAdvance = advances.some((a) => a.documentStatus !== 'CANCELLED' && a.postingStatus !== 'REVERSED');
      const releaseBlock = first(gate(canPay, 'MISSING_PERMISSION'), gate(poOpen, 'PAYMENT_PO_NOT_OPEN'), gate(position.remaining.greaterThan(0), 'NOTHING_TO_FUND'));
      allowedActions.push(hasAdvance ? act('TOP_UP', releaseBlock === null, releaseBlock ?? undefined) : act('RELEASE_CASH', releaseBlock === null, releaseBlock ?? undefined));
      const returnBlock = first(gate(canPay, 'MISSING_PERMISSION'), gate(withBuyer.greaterThan(0), 'NOTHING_WITH_BUYER'));
      allowedActions.push(act('RECORD_RETURN', returnBlock === null, returnBlock ?? undefined));
    } else {
      const unappliedPrepayment = payments.some(
        (p) => p.postingStatus === 'POSTED' && dec(p.unallocatedAmount).greaterThan(0) && po !== null && p.purchaseAllocations.some((x) => x.purchaseOrderId === po.id),
      );
      const billWaiting = dec(postedBillOutstanding).greaterThan(0);
      const payBlock = first(
        gate(canPay, 'MISSING_PERMISSION'),
        gate(!(unappliedPrepayment && billWaiting), 'PREPAYMENT_NOT_APPLIED'),
        gate(poOpen, 'PAYMENT_PO_NOT_OPEN'),
        gate(position.remaining.greaterThan(0), 'NOTHING_TO_FUND'),
        gate(!isMaintainer, 'VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT'),
      );
      allowedActions.push(act('PAY_SUPPLIER', payBlock === null, payBlock ?? undefined));
      const applyBlock = first(
        gate(canPay, 'MISSING_PERMISSION'),
        gate(unappliedPrepayment, 'NO_UNAPPLIED_PREPAYMENT'),
        gate(billWaiting, 'NO_POSTED_BILL'),
      );
      allowedActions.push(act('APPLY_PREPAYMENT', applyBlock === null, applyBlock ?? undefined));
      const finishBlock = first(gate(canPay, 'MISSING_PERMISSION'), gate(unposted.length > 0, 'NOTHING_TO_FINISH'));
      allowedActions.push(act('FINISH_PAYMENT', finishBlock === null, finishBlock ?? undefined));
    }
    const isCollector = this.access.evidenceTouchers(request).includes(identity.userId);
    const photoBlock = first(gate(has(PERMISSIONS.quotationsCollect) && isCollector, 'MISSING_PERMISSION'), gate(poOpen, 'PAYMENT_PO_NOT_OPEN'));
    allowedActions.push(act('PHOTOGRAPH_RECEIPT', photoBlock === null, photoBlock ?? undefined));
    const recordBlock = first(
      gate(canPay, 'MISSING_PERMISSION'),
      gate(submitted.length > 0, 'NO_RECEIPT_TO_RECORD'),
      gate(receivingStatus !== 'NOT_RECEIVED', 'GOODS_NOT_RECEIVED'),
    );
    allowedActions.push(act('RECORD_RECEIPT', recordBlock === null, recordBlock ?? undefined));
    const pathBlock = first(gate(canPay && has(PERMISSIONS.quotationsAward), 'MISSING_PERMISSION'), gate(!liveFunding, 'PAYMENT_PATH_LOCKED'));
    allowedActions.push(act('CHANGE_PATH', pathBlock === null, pathBlock ?? undefined));

    // Review (coordinator) — the attempts that wait to be finished, so "Complete the release /
    // payment" works from any device without a client-held body or a second attempt: re-drive with
    // `continue` (no body). A DRAFT waits for approval; an APPROVED / RELEASED payment for its
    // signatures or the post.
    const pending: Array<{
      kind: 'BUYER_ADVANCE' | 'SUPPLIER_PAYMENT';
      id: string;
      idempotencyKey: string | null;
      amount: string | null;
      awaiting: 'APPROVAL' | 'RELEASE_SIGNATURES' | 'POSTING';
      approvalInstanceId: string | null;
      continue: { method: 'POST'; path: string };
    }> = [];
    for (const a of advances.filter((x) => x.documentStatus === 'DRAFT' && x.postingStatus === 'NOT_POSTED')) {
      const latest = await this.commandGovernance.latestApproval(WorkflowTransactionType.SUPPLIER_PAYMENT, a.id);
      const open = latest && (latest.status === 'PENDING' || latest.status === 'APPROVED') ? latest : null;
      pending.push({
        kind: 'BUYER_ADVANCE',
        id: a.id,
        idempotencyKey: a.idempotencyKey,
        amount: money(dec(a.amount)),
        awaiting: open ? 'APPROVAL' : 'POSTING',
        approvalInstanceId: open?.id ?? a.approvalInstanceId ?? null,
        continue: { method: 'POST', path: `/buyer-advances/${a.id}/post` },
      });
    }
    for (const p of payments.filter((x) => x.quotationRequestId === request.id && x.postingStatus !== 'POSTED' && x.postingStatus !== 'REVERSED' && x.documentStatus !== 'CANCELLED' && x.documentStatus !== 'REJECTED')) {
      const latest = p.documentStatus === 'DRAFT' ? await this.commandGovernance.latestApproval(WorkflowTransactionType.SUPPLIER_PAYMENT, p.id) : null;
      const open = latest && (latest.status === 'PENDING' || latest.status === 'APPROVED') ? latest : null;
      const signatories = p.documentStatus === 'APPROVED' ? await db.bankAccountSignatory.count({ where: { bankAccountId: p.bankAccountId, isActive: true } }) : 0;
      pending.push({
        kind: 'SUPPLIER_PAYMENT',
        id: p.id,
        idempotencyKey: p.idempotencyKey,
        amount: money(dec(p.totalAmount)),
        awaiting: p.documentStatus === 'DRAFT' ? (open ? 'APPROVAL' : 'POSTING') : signatories > 0 && p.documentStatus === 'APPROVED' ? 'RELEASE_SIGNATURES' : 'POSTING',
        approvalInstanceId: open?.id ?? null,
        continue: { method: 'POST', path: `/supplier-payments/${p.id}/continue` },
      });
    }

    const photosVisible = canSeeQuotationPhotos(identity);
    return {
      pending,
      path: request.paymentPath,
      state,
      purchaseOrder: po ? { id: po.id, poNumber: po.poNumber, status: po.status } : null,
      orderedAmount: money(po ? ordered : null),
      funded: money(po ? position.funded : null),
      remainingToFund: money(po ? position.remaining : null),
      withBuyer: money(withBuyer),
      advances: visible
        ? advanceRows.map(({ a, legacy, applied, returned, outstanding }) => ({
            id: a.id,
            recipientUserId: a.recipientUserId,
            recipientName: name(a.recipientUserId),
            amount: dec(a.amount).toFixed(2),
            advancedAt: day(a.advancedAt),
            documentStatus: a.documentStatus,
            postingStatus: a.postingStatus,
            applied: applied.toFixed(2),
            returned: returned.toFixed(2),
            outstanding: outstanding.toFixed(2),
            legacy,
          }))
        : null,
      payments: visible
        ? payments.map((p) => ({
            id: p.id,
            number: p.paymentNumber,
            amount: dec(p.totalAmount).toFixed(2),
            shape: po && p.purchaseAllocations.some((x) => x.purchaseOrderId === po.id) ? 'PREPAY' : 'PAY_BILL',
            documentStatus: p.documentStatus,
            postingStatus: p.postingStatus,
          }))
        : null,
      storeDocuments: docs.map((d) => ({
        id: d.id,
        number: d.number,
        kind: d.kind,
        status: d.status,
        uploadedByName: name(d.uploadedBy),
        createdAt: d.createdAt,
        supplierBillId: d.supplierBillId,
        photoCount: d.photos.length,
        ...(photosVisible ? { photos: d.photos.map((p) => ({ id: p.id, fileId: p.platformFileId, pageNumber: p.pageNumber })) } : {}),
      })),
      receivingStatus,
      ...(approval ? { approval } : {}),
      allowedActions,
      moneyVisible: visible,
    };
  }

  /** R14 — is anything live funding the award's order (path change refused)? */
  async hasLiveFunding(db: Db, request: { id: string; organizationId: string; purchaseOrderId: string | null }): Promise<boolean> {
    const orgId = request.organizationId;
    const [advances, payments] = await Promise.all([
      request.purchaseOrderId
        ? db.buyerAdvance.count({
            where: { organizationId: orgId, purchaseOrderId: request.purchaseOrderId, documentStatus: { notIn: ['CANCELLED', 'REJECTED'] }, postingStatus: { not: 'REVERSED' } },
          })
        : Promise.resolve(0),
      db.supplierPayment.count({
        where: {
          organizationId: orgId,
          documentStatus: { notIn: ['CANCELLED', 'REJECTED'] },
          postingStatus: { not: 'REVERSED' },
          OR: [
            { quotationRequestId: request.id },
            ...(request.purchaseOrderId
              ? [
                  { purchaseAllocations: { some: { purchaseOrderId: request.purchaseOrderId } } },
                  { allocations: { some: { bill: { purchaseOrderId: request.purchaseOrderId } } } },
                ]
              : []),
          ],
        },
      }),
    ]);
    return advances + payments > 0;
  }
}
