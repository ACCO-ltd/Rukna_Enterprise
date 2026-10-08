import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { WorkflowTransactionType, type RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { ApprovalService } from '../../../../platform/workflows/application/approval.service.js';
import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';
import { driveGovernedTransition } from '../../../../platform/workflows/application/governed-transition.driver.js';
import { PeriodValidator } from '../../accounting-core/application/validators/period.validator.js';
import { periodPostingBlock } from '../../accounting-core/domain/period-posting.policy.js';
import { BankAccountSignatoryService } from '../../accounting-core/application/bank-account-signatory.service.js';
import { AwardPaymentRepository } from '../infrastructure/award-payment.repository.js';
import { SupplierPaymentRepository } from '../infrastructure/supplier-payment.repository.js';
import { PurchaseAllocationRepository } from '../infrastructure/purchase-allocation.repository.js';
import { fundingAllows, fundingPosition, releaseBlockers } from '../domain/award-payment.policy.js';
import { billSettlementBlock } from '../domain/supplier-bill-eligibility.policy.js';
import {
  parseDateOnly,
  parseMoney,
  paymentConflict,
  paymentUnprocessable,
  todayInMogadishu,
} from '../domain/payment-errors.js';
import { AWARD_PAYMENT_READ_MODEL, type AwardPaymentReadModel } from '../domain/award-payment-events.port.js';
import { SupplierPaymentService } from './supplier-payment.service.js';
import { PurchaseOrderService } from '../../../procurement/purchase-orders/application/purchase-order.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';

export type PayShape = 'PREPAY' | 'PAY_BILL';

export interface PayFromAwardCommand {
  idempotencyKey: string;
  quotationRequestId: string;
  bankAccountId: string;
  paymentMethod: 'BANK' | 'MOBILE_MONEY';
  paymentDate: string;
  amount: string | number;
  shape: PayShape;
  supplierBillId?: string;
  bankReference?: string;
  note?: string;
}

const ZERO = new Decimal(0);
const dec = (v: { toString(): string } | null | undefined) => new Decimal(v ? v.toString() : 0);

/**
 * ADR-045 §3 — FINANCE_PAYS_SUPPLIER: the existing supplier payment, prefilled from the award and
 * driven create → approve → post in one command (`POST /supplier-payments/from-award`).
 *
 *  - PREPAY (no bill yet): an unallocated payment (EVT-AP-003 B, Dr Supplier advance / Cr Bank)
 *    plus a purchase allocation to the PO, created in one transaction under the PO lock;
 *  - PAY_BILL: an allocation to the PO's posted bill (EVT-AP-003 A).
 *
 * Controls are the existing ones: vendor-maintainer SoD at create (a selector who registered the
 * store cannot pay it), bill-approver SoD and the supplier-payment bands at approve (the payer's
 * tap counts as their own step), dual control at release (the command then stops at APPROVED with
 * `awaiting: 'RELEASE_SIGNATURES'`). Funding cap (409 FUNDING_EXCEEDS_ORDER). Idempotent on the
 * key: a re-drive continues from the document's state.
 */
@Injectable()
export class AwardSupplierPaymentService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly awardRepo: AwardPaymentRepository,
    private readonly paymentRepo: SupplierPaymentRepository,
    private readonly purchaseAllocationRepo: PurchaseAllocationRepository,
    private readonly payments: SupplierPaymentService,
    private readonly signatories: BankAccountSignatoryService,
    private readonly commandGovernance: CommandGovernanceService,
    private readonly approvals: ApprovalService,
    private readonly sod: SegregationOfDutiesService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly projectAccess: ProjectAccessService,
    @Optional() @Inject(AWARD_PAYMENT_READ_MODEL) private readonly readModel?: AwardPaymentReadModel,
  ) {}

  /** `GET /supplier-payments/award-draft?quotationRequestId=` — prefill, shape and blockers. */
  async awardDraft(identity: RequestIdentity, quotationRequestId: string) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const request = await this.awardRepo.findRequest(prisma, orgId, quotationRequestId);
    if (!request) throw new NotFoundException(`Quotation request ${quotationRequestId} not found`);
    const po = request.purchaseOrderId ? await this.awardRepo.findPurchaseOrder(prisma, orgId, request.purchaseOrderId) : null;
    const revision = po ? await this.awardRepo.activeRevision(prisma, po.id) : null;
    const position = po
      ? fundingPosition(await this.awardRepo.fundingInputs(prisma, orgId, po.id, revision?.ordered ?? ZERO))
      : { cap: ZERO, funded: ZERO, remaining: ZERO };
    const currencyCode = revision?.currencyCode ?? request.currencyCode;
    const supplier = po
      ? await prisma.supplier.findFirst({ where: { id: po.supplierId, organizationId: orgId }, select: { id: true, name: true, createdBy: true } })
      : null;
    const maintainer = supplier?.createdBy
      ? await prisma.user.findFirst({ where: { id: supplier.createdBy }, select: { firstName: true, lastName: true } })
      : null;
    const codes = await this.sod.activeRuleCodes(orgId);
    const isVendorMaintainer = Boolean(
      supplier?.createdBy === identity.userId && codes.has('VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT'),
    );
    const bills = po
      ? await prisma.supplierBill.findMany({
          where: { organizationId: orgId, purchaseOrderId: po.id, postingStatus: 'POSTED', outstandingAmount: { gt: 0 } },
          orderBy: { billDate: 'asc' },
          select: { id: true, billNumber: true, supplierInvoiceNumber: true, outstandingAmount: true },
        })
      : [];
    const unapplied = po ? await this.unappliedPrepayments(prisma, orgId, po.id) : [];
    const lastUsed = await this.awardRepo.lastPaymentAccountId(prisma, orgId, identity.userId);
    const accounts = (await this.awardRepo.paymentAccounts(prisma, orgId, currencyCode))
      .filter((a) => a.status === 'ACTIVE' && a.allowsPayments)
      .map((a) => ({
        bankAccountId: a.id,
        name: a.bankName === a.accountName ? a.bankName : `${a.bankName} · ${a.accountName}`,
        glCode: a.glCode,
        underDualControl: a.activeSignatories > 0,
        lastUsed: a.id === lastUsed,
      }));
    return {
      supplier: supplier
        ? {
            id: supplier.id,
            name: supplier.name,
            isVendorMaintainer,
            maintainerName: maintainer ? `${maintainer.firstName} ${maintainer.lastName}`.trim() : null,
          }
        : null,
      shape: (bills.length > 0 ? 'PAY_BILL' : 'PREPAY') as PayShape,
      // Review H1 — a posted prepayment not yet applied to the bill must be applied, not paid again.
      unappliedPrepayments: unapplied.map((u) => ({ paymentId: u.id, unallocated: u.unallocated.toFixed(2) })),
      bills: bills.map((b) => ({ id: b.id, number: b.billNumber ?? b.supplierInvoiceNumber, outstanding: dec(b.outstandingAmount).toFixed(2) })),
      remainingToFund: position.remaining.toFixed(2),
      currencyCode,
      accounts,
      methods: ['BANK', 'MOBILE_MONEY'] as const,
      defaultPaymentDate: todayInMogadishu(),
      bandHint: await this.bandHint(orgId, position.remaining),
      blockers: releaseBlockers({
        requestAwarded: request.status === 'AWARDED',
        poOpen: po?.status === 'OPEN',
        pathMatches: request.paymentPath === 'FINANCE_PAYS_SUPPLIER',
        remainingToFund: position.remaining,
        usableAccounts: accounts.length,
        callerIsVendorMaintainer: isVendorMaintainer,
      }).concat(unapplied.length > 0 && bills.length > 0 ? (['PREPAYMENT_NOT_APPLIED'] as never[]) : []),
    };
  }

  /** `POST /supplier-payments/from-award` — create → approve → (release) → post. */
  async payFromAward(identity: RequestIdentity, cmd: PayFromAwardCommand) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const amountText = parseMoney(cmd.amount);
    if (!amountText) throw paymentUnprocessable('AMOUNT_INVALID');
    const amount = new Decimal(amountText);
    const paymentDate = parseDateOnly(cmd.paymentDate);
    if (!paymentDate) throw paymentUnprocessable('DATE_INVALID');
    if (!cmd.idempotencyKey?.trim()) throw new BadRequestException('idempotencyKey is required');

    const existing = await prisma.supplierPayment.findFirst({ where: { organizationId: orgId, idempotencyKey: cmd.idempotencyKey } });
    if (existing) {
      // Review LOW: a replay must be the same command in every field.
      const [purchaseAllocs, billAllocs] = await Promise.all([
        prisma.supplierPaymentPurchaseAllocation.count({ where: { supplierPaymentId: existing.id } }),
        prisma.supplierPaymentAllocation.findMany({ where: { supplierPaymentId: existing.id }, select: { supplierBillId: true } }),
      ]);
      const existingShape: PayShape = purchaseAllocs > 0 ? 'PREPAY' : 'PAY_BILL';
      const same =
        existing.quotationRequestId === cmd.quotationRequestId &&
        dec(existing.totalAmount).equals(amount) &&
        existing.bankAccountId === cmd.bankAccountId &&
        existing.paymentMethod === cmd.paymentMethod &&
        existing.paymentDate.getTime() === paymentDate.getTime() &&
        existingShape === cmd.shape &&
        (cmd.shape === 'PREPAY' || billAllocs.some((a) => a.supplierBillId === cmd.supplierBillId));
      if (!same) throw paymentConflict('IDEMPOTENCY_KEY_REUSED');
      return this.continueFrom(identity, existing.id);
    }

    const request = await this.awardRepo.findRequest(prisma, orgId, cmd.quotationRequestId);
    if (!request) throw new NotFoundException(`Quotation request ${cmd.quotationRequestId} not found`);
    if (request.projectId) await this.projectAccess.assertMember(identity, request.projectId);
    const po = request.purchaseOrderId ? await this.awardRepo.findPurchaseOrder(prisma, orgId, request.purchaseOrderId) : null;
    // Review H1 — paying a bill while a posted prepayment on the order is unapplied would pay twice.
    if (cmd.shape === 'PAY_BILL' && po) {
      const unapplied = await this.unappliedPrepayments(prisma, orgId, po.id);
      if (unapplied.length > 0) {
        throw paymentConflict('PREPAYMENT_NOT_APPLIED', {
          unappliedPrepayments: unapplied.map((u) => ({ paymentId: u.id, unallocated: u.unallocated.toFixed(2) })),
        });
      }
    }
    if (request.status !== 'AWARDED' || !po || po.status !== 'OPEN') throw paymentConflict('PAYMENT_PO_NOT_OPEN');
    if (request.paymentPath !== 'FINANCE_PAYS_SUPPLIER') throw paymentConflict('PAYMENT_PATH_MISMATCH');
    const revision = await this.awardRepo.activeRevision(prisma, po.id);
    const currencyCode = revision?.currencyCode ?? request.currencyCode;

    const account = await this.awardRepo.findPaymentAccount(prisma, orgId, cmd.bankAccountId);
    if (!account) throw new NotFoundException(`BankAccount ${cmd.bankAccountId} not found in this organization`);
    if (account.status !== 'ACTIVE' || !account.allowsPayments) throw paymentUnprocessable('ACCOUNT_NOT_USABLE');
    if (account.currencyCode !== currencyCode) throw paymentUnprocessable('CURRENCY_MISMATCH');
    if (cmd.shape === 'PREPAY' && cmd.supplierBillId) throw paymentUnprocessable('PAYMENT_SHAPE_INVALID');
    if (cmd.shape === 'PAY_BILL' && !cmd.supplierBillId) throw paymentUnprocessable('PAYMENT_SHAPE_INVALID');
    await this.assertPeriodOpen(orgId, paymentDate);

    // R13 — ADR-022: the vendor maintainer cannot process a payment to that vendor (existing rule).
    const supplier = await prisma.supplier.findFirst({ where: { id: po.supplierId, organizationId: orgId }, select: { createdBy: true } });
    await this.sod.assertAllowed({
      organizationId: orgId,
      action: 'PROCESS_SUPPLIER_PAYMENT',
      actorUserId: identity.userId,
      vendorMaintainerUserId: supplier?.createdBy ?? undefined,
    });

    // The bill-approver rule (ADR-022, checked again at approve) refused BEFORE anything is written,
    // so a refused tap never leaves a draft holding the bill's outstanding.
    if (cmd.shape === 'PAY_BILL') {
      const bill = await prisma.supplierBill.findFirst({ where: { id: cmd.supplierBillId!, organizationId: orgId }, select: { approvedBy: true } });
      await this.sod.assertAllowed({
        organizationId: orgId,
        action: 'APPROVE_OR_RELEASE_SUPPLIER_PAYMENT',
        actorUserId: identity.userId,
        supplierBillApproverUserId: bill?.approvedBy === identity.userId ? identity.userId : undefined,
      });
    }

    let paymentId: string;
    try {
      paymentId = await prisma.$transaction(async (tx) => {
        const locked = await this.awardRepo.lockPurchaseOrder(tx, orgId, po.id);
        if (!locked || locked.status !== 'OPEN') throw paymentConflict('PAYMENT_PO_NOT_OPEN');
        const position = fundingPosition(await this.awardRepo.fundingInputs(tx, orgId, po.id, revision?.ordered ?? ZERO));
        // ADR-045 review H1 — both shapes are capped (a bill payment funds the order too), and a
        // bill cannot be paid again while a posted prepayment on the order is still unapplied:
        // apply the prepayment first (POST /payments/:id/allocations).
        if (cmd.shape === 'PAY_BILL') {
          const unapplied = await this.unappliedPrepayments(tx, orgId, po.id);
          if (unapplied.length > 0) {
            throw paymentConflict('PREPAYMENT_NOT_APPLIED', {
              unappliedPrepayments: unapplied.map((u) => ({ paymentId: u.id, unallocated: u.unallocated.toFixed(2) })),
            });
          }
        }
        if (!fundingAllows(position, amount)) {
          throw paymentConflict('FUNDING_EXCEEDS_ORDER', {
            orderedAmount: position.cap.toFixed(2),
            funded: position.funded.toFixed(2),
            requested: amount.toFixed(2),
          });
        }
        const created = await this.paymentRepo.create(tx as never, {
          organizationId: orgId,
          supplierId: po.supplierId,
          bankAccountId: account.id,
          paymentDate,
          accountingDate: paymentDate,
          currencyCode,
          totalAmount: amount,
          allocatedAmount: cmd.shape === 'PAY_BILL' ? amount : ZERO,
          unallocatedAmount: cmd.shape === 'PAY_BILL' ? ZERO : amount,
          paymentMethod: cmd.paymentMethod,
          bankReference: cmd.bankReference,
          notes: cmd.note,
          createdBy: identity.userId,
        });
        await tx.supplierPayment.update({
          where: { id: created.id },
          data: { idempotencyKey: cmd.idempotencyKey, quotationRequestId: request.id },
        });
        if (cmd.shape === 'PAY_BILL') {
          await this.awardRepo.lockSupplierBill(tx, cmd.supplierBillId!);
          const bill = await tx.supplierBill.findFirst({ where: { id: cmd.supplierBillId!, organizationId: orgId } });
          if (!bill || bill.purchaseOrderId !== po.id || bill.supplierId !== po.supplierId || bill.currencyCode !== currencyCode) {
            throw paymentUnprocessable('PAYMENT_SHAPE_INVALID');
          }
          if (billSettlementBlock(bill, amount) !== null || bill.postingStatus !== 'POSTED') {
            throw paymentUnprocessable('PAYMENT_SHAPE_INVALID', { billOutstanding: dec(bill.outstandingAmount).toFixed(2) });
          }
          await this.paymentRepo.createAllocation(tx as never, {
            organizationId: orgId,
            supplierPaymentId: created.id,
            supplierBillId: bill.id,
            allocatedAmount: amount,
            allocationDate: paymentDate,
            postingStatus: 'NOT_POSTED',
            createdBy: identity.userId,
          });
          const upd = await tx.supplierBill.updateMany({
            where: { id: bill.id, outstandingAmount: { gte: amount } },
            data: { outstandingAmount: { decrement: amount } },
          });
          if (upd.count !== 1) throw paymentUnprocessable('PAYMENT_SHAPE_INVALID');
        } else {
          await this.purchaseAllocationRepo.create(tx as never, {
            organizationId: orgId,
            supplierPaymentId: created.id,
            purchaseOrderId: po.id,
            allocatedAmount: amount,
            allocationDate: paymentDate,
            notes: `Paid before goods from ${request.number}`,
            createdBy: identity.userId,
          });
        }
        const after = await tx.supplierPayment.findUniqueOrThrow({ where: { id: created.id } });
        await this.auditOutbox.record(tx, {
          organizationId: orgId,
          actorUserId: identity.userId,
          action: 'CREATE',
          resourceType: 'SupplierPayment',
          resourceId: created.id,
          sourceCommand: 'supplier-payment.from-award',
          eventType: 'SUPPLIER_PAYMENT_CREATED_FROM_AWARD',
          idempotencyKey: `supplier-payment-${created.id}-CREATED_FROM_AWARD-${after.updatedAt.getTime()}`,
          after: {
            quotationRequestId: request.id,
            purchaseOrderId: po.id,
            shape: cmd.shape,
            amount: amount.toFixed(2),
            paymentDate: paymentDate.toISOString().slice(0, 10),
            supplierBillId: cmd.supplierBillId ?? null,
          },
        });
        return created.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return this.payFromAward(identity, cmd);
      throw error;
    }
    return this.continueFrom(identity, paymentId);
  }

  /**
   * `POST /supplier-payments/:id/continue` — re-drive a payment made from an award from whatever
   * state it is in, with no client-held body (another device can finish it).
   */
  async continuePayment(identity: RequestIdentity, paymentId: string) {
    const prisma = this.tenancy.getClient();
    const payment = await prisma.supplierPayment.findFirst({ where: { id: paymentId, organizationId: identity.activeOrganizationId } });
    if (!payment) throw new NotFoundException(`SupplierPayment ${paymentId} not found`);
    if (!payment.quotationRequestId) throw paymentConflict('PAYMENT_PO_NOT_OPEN', {}, 'This payment was not made from a quotation award.');
    const request = await this.awardRepo.findRequest(prisma, identity.activeOrganizationId, payment.quotationRequestId);
    if (request?.projectId) await this.projectAccess.assertMember(identity, request.projectId);
    return this.continueFrom(identity, paymentId);
  }

  /** Approve (bands, self step) → release (dual control: stop) → post — from whatever state it is in. */
  private async continueFrom(identity: RequestIdentity, paymentId: string) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    let payment = await prisma.supplierPayment.findFirstOrThrow({ where: { id: paymentId, organizationId: orgId } });

    if (payment.documentStatus === 'DRAFT') {
      // Review M5 — the vendor-maintainer rule again on a re-drive (another person may be driving).
      const supplier = await prisma.supplier.findFirst({ where: { id: payment.supplierId, organizationId: orgId }, select: { createdBy: true } });
      await this.sod.assertAllowed({
        organizationId: orgId,
        action: 'PROCESS_SUPPLIER_PAYMENT',
        actorUserId: identity.userId,
        vendorMaintainerUserId: supplier?.createdBy ?? undefined,
      });
      // ADR-022 CONST-DOA-003 (existing rule): an approver of a bill this payment settles cannot approve it.
      const allocations = await prisma.supplierPaymentAllocation.findMany({
        where: { supplierPaymentId: paymentId },
        select: { bill: { select: { approvedBy: true } } },
      });
      const approvedASettledBill = allocations.some((a) => a.bill.approvedBy === identity.userId);
      await this.sod.assertAllowed({
        organizationId: orgId,
        action: 'APPROVE_OR_RELEASE_SUPPLIER_PAYMENT',
        actorUserId: identity.userId,
        supplierBillApproverUserId: approvedASettledBill ? identity.userId : undefined,
      });
      // ADR-045 review M5/M7 — the existing approve command (SoD, DoA, audit, consumption in its
      // transaction), with the payer's tap as their own step and the band chosen on the order's
      // cumulative funding (this payment included), so splitting cannot stay in a lower band.
      try {
        await this.payments.approve(identity, paymentId, {
          selfApprove: true,
          bandAmount: await this.cumulativeFunding(paymentId, dec(payment.totalAmount)),
          note: 'Paid from the quotation award',
        });
      } catch (error) {
        // A double tap approved it a moment ago: carry on from the approved document.
        const now = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: paymentId } });
        if (now.documentStatus === 'DRAFT') throw error;
      }
      payment = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: paymentId } });
    }

    if (payment.postingStatus !== 'POSTED') {
      const dual = await this.signatories.requiresDualControl(prisma, payment.bankAccountId);
      if (dual && payment.documentStatus === 'APPROVED') return this.result(identity, paymentId, 'RELEASE_SIGNATURES');
      try {
        await this.payments.post(identity, { paymentId });
      } catch (error) {
        // A double tap posted it a moment ago: answer with the posted payment.
        const now = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: paymentId } });
        if (now.postingStatus !== 'POSTED') throw error;
      }
      // Paying the posted invoice can complete the order's settlement.
      const request = payment.quotationRequestId ? await this.awardRepo.findRequest(prisma, orgId, payment.quotationRequestId) : null;
      if (request?.purchaseOrderId) await this.purchaseOrders.autoCloseIfSettled(identity, request.purchaseOrderId);
    }
    return this.result(identity, paymentId);
  }

  /** Review M7 — Σ live funding of the order this award payment funds (this payment included). */
  private async cumulativeFunding(paymentId: string, fallback: Decimal): Promise<Decimal> {
    const prisma = this.tenancy.getClient();
    const payment = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: paymentId }, select: { organizationId: true, quotationRequestId: true } });
    const request = payment.quotationRequestId ? await this.awardRepo.findRequest(prisma, payment.organizationId, payment.quotationRequestId) : null;
    if (!request?.purchaseOrderId) return fallback;
    const revision = await this.awardRepo.activeRevision(prisma, request.purchaseOrderId);
    const position = fundingPosition(await this.awardRepo.fundingInputs(prisma, payment.organizationId, request.purchaseOrderId, revision?.ordered ?? ZERO));
    return position.funded.greaterThan(fallback) ? position.funded : fallback;
  }

  /** Posted prepayments (purchase allocation to this order) with an unapplied balance. */
  async unappliedPrepayments(db: Prisma.TransactionClient | ReturnType<TenancyService['getClient']>, orgId: string, purchaseOrderId: string) {
    const rows = await db.supplierPayment.findMany({
      where: {
        organizationId: orgId,
        postingStatus: 'POSTED',
        unallocatedAmount: { gt: 0 },
        purchaseAllocations: { some: { purchaseOrderId } },
      },
      select: { id: true, unallocatedAmount: true },
      orderBy: { paymentDate: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, unallocated: dec(r.unallocatedAmount) }));
  }

  private async result(identity: RequestIdentity, paymentId: string, awaiting?: 'RELEASE_SIGNATURES') {
    const payment = await this.payments.findById(identity, paymentId);
    const purchaseAllocations = await this.purchaseAllocationRepo.findByPayment(this.tenancy.getClient(), identity.activeOrganizationId, paymentId);
    const paymentView = { ...payment, shape: purchaseAllocations.length > 0 ? 'PREPAY' : 'PAY_BILL' };
    const read =
      payment.quotationRequestId && this.readModel ? await this.readModel.paymentOf(identity, payment.quotationRequestId) : null;
    return { payment: paymentView, ...(awaiting ? { awaiting } : {}), paymentSummary: read };
  }

  private async assertPeriodOpen(orgId: string, date: Date) {
    const prisma = this.tenancy.getClient();
    const period = await PeriodValidator.findCovering(prisma, orgId, date);
    const block = periodPostingBlock(period ? { name: period.name, status: period.status } : null, 'CASH_AND_BANK');
    if (block) throw paymentConflict(block, { date: date.toISOString().slice(0, 10) }, `No open accounting period for ${date.toISOString().slice(0, 10)} (${block}).`);
  }

  private async bandHint(orgId: string, amount: Decimal) {
    const prisma = this.tenancy.getClient();
    const bindings = await prisma.workflowTriggerBinding.findMany({
      where: { organizationId: orgId, entityType: 'SupplierPayment', fromState: 'DRAFT', toState: 'APPROVED', isActive: true },
      include: { definition: { include: { steps: { orderBy: { stepOrder: 'asc' } } } } },
    });
    const band = bindings.find(
      (b) =>
        b.definition.isActive &&
        (b.minAmount === null || amount.greaterThanOrEqualTo(dec(b.minAmount))) &&
        (b.maxAmount === null || amount.lessThan(dec(b.maxAmount))),
    );
    return band ? { name: band.definition.name, steps: band.definition.steps.map((s) => s.roleRequired) } : null;
  }
}
