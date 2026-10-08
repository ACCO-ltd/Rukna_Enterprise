import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import type { FundingInputs } from '../domain/award-payment.policy.js';
import { STAFF_ADVANCE_PROFILE_CODE } from '../domain/staff-advance-profile.js';

type Db = Prisma.TransactionClient | Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const dec = (v: { toString(): string } | null | undefined) => new Decimal(v ? v.toString() : 0);

/** The quotation request facts a payment command checks (read directly: no module import, ADR-044 pattern). */
export interface AwardRequestFacts {
  id: string;
  organizationId: string;
  number: string;
  status: string;
  paymentPath: 'BUYER_CASH' | 'FINANCE_PAYS_SUPPLIER' | null;
  purchaseOrderId: string | null;
  currencyCode: string;
  projectId: string | null;
  createdBy: string;
  awardedSupplierId: string | null;
  materialRequestId: string;
  /** The request creator, every quote uploader and every collect-command actor. */
  collectorIds: string[];
}

export interface StaffAdvanceAccount {
  accountId: string;
  versionId: string;
  versionNumber: number;
}

/**
 * ADR-045 — the reads and locks paying from an award needs, shared by the buyer-advance, supplier
 * payment and store-document settlement commands.
 */
@Injectable()
export class AwardPaymentRepository {
  /**
   * `SELECT … FOR UPDATE` on the purchase order — every payment command from an award takes it
   * first (lock order PO → advance/payment → bill), so concurrent releases serialise on the cap.
   */
  async lockPurchaseOrder(tx: Prisma.TransactionClient, organizationId: string, purchaseOrderId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string; status: string; supplier_id: string; po_number: string }>>`
      SELECT id, status, supplier_id, po_number FROM purchase_orders
      WHERE id = ${purchaseOrderId} AND organization_id = ${organizationId}
      FOR UPDATE`;
    const row = rows[0];
    return row ? { id: row.id, status: row.status, supplierId: row.supplier_id, poNumber: row.po_number } : null;
  }

  async lockBuyerAdvance(tx: Prisma.TransactionClient, advanceId: string) {
    await tx.$queryRaw`SELECT id FROM buyer_advances WHERE id = ${advanceId} FOR UPDATE`;
  }

  async lockSupplierBill(tx: Prisma.TransactionClient, billId: string) {
    await tx.$queryRaw`SELECT id FROM supplier_bills WHERE id = ${billId} FOR UPDATE`;
  }

  findPurchaseOrder(db: Db, organizationId: string, purchaseOrderId: string) {
    return db.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId },
      select: { id: true, status: true, poNumber: true, supplierId: true, createdBy: true },
    });
  }

  private requestSelect = {
    id: true,
    organizationId: true,
    number: true,
    status: true,
    paymentPath: true,
    purchaseOrderId: true,
    currencyCode: true,
    projectId: true,
    createdBy: true,
    awardedSupplierId: true,
    materialRequestId: true,
    collectActorIds: true,
    quotes: { select: { uploadedBy: true, withdrawnBy: true, photos: { select: { uploadedBy: true } } } },
  } satisfies Prisma.QuotationRequestSelect;

  private toFacts(r: Prisma.QuotationRequestGetPayload<{ select: AwardPaymentRepository['requestSelect'] }>): AwardRequestFacts {
    const collectors = new Set<string>([r.createdBy, ...(r.collectActorIds ?? [])]);
    for (const q of r.quotes) {
      collectors.add(q.uploadedBy);
      for (const p of q.photos) collectors.add(p.uploadedBy);
    }
    return {
      id: r.id,
      organizationId: r.organizationId,
      number: r.number,
      status: r.status,
      paymentPath: r.paymentPath,
      purchaseOrderId: r.purchaseOrderId,
      currencyCode: r.currencyCode,
      projectId: r.projectId,
      createdBy: r.createdBy,
      awardedSupplierId: r.awardedSupplierId,
      materialRequestId: r.materialRequestId,
      collectorIds: [...collectors],
    };
  }

  async findRequest(db: Db, organizationId: string, requestId: string): Promise<AwardRequestFacts | null> {
    const r = await db.quotationRequest.findFirst({ where: { id: requestId, organizationId }, select: this.requestSelect });
    return r ? this.toFacts(r) : null;
  }

  /** The award a purchase order was raised from (null for an order that did not come from one). */
  async findRequestForPurchaseOrder(db: Db, organizationId: string, purchaseOrderId: string): Promise<AwardRequestFacts | null> {
    const r = await db.quotationRequest.findFirst({ where: { purchaseOrderId, organizationId }, select: this.requestSelect });
    return r ? this.toFacts(r) : null;
  }

  /** Σ qty × unit price over the PO's ACTIVE revision; with its lines (for the receipt split). */
  async activeRevision(db: Db, purchaseOrderId: string) {
    const revision = await db.purchaseOrderRevision.findFirst({
      where: { purchaseOrderId, status: 'ACTIVE' },
      select: {
        id: true,
        currencyCode: true,
        lines: {
          select: {
            id: true,
            lineNumber: true,
            description: true,
            lineType: true,
            materialId: true,
            orderedQuantity: true,
            unitPrice: true,
            unitOfMeasureId: true,
            projectId: true,
          },
          orderBy: { lineNumber: 'asc' },
        },
      },
    });
    if (!revision) return null;
    const ordered = revision.lines.reduce((s, l) => s.add(dec(l.unitPrice).mul(dec(l.orderedQuantity))), new Decimal(0));
    return { ...revision, ordered: ordered.toDecimalPlaces(2, Decimal.ROUND_HALF_UP) };
  }

  /** Everything the funding cap counts for one PO (§1), read under the PO lock by the caller. */
  async fundingInputs(db: Db, organizationId: string, purchaseOrderId: string, ordered: Decimal): Promise<FundingInputs> {
    const [advances, purchaseAllocations, bills] = await Promise.all([
      db.buyerAdvance.findMany({
        where: { organizationId, purchaseOrderId },
        select: { amount: true, documentStatus: true, postingStatus: true, returns: { select: { amount: true } } },
      }),
      db.supplierPaymentPurchaseAllocation.findMany({
        where: { organizationId, purchaseOrderId },
        select: {
          allocatedAmount: true,
          supplierPayment: { select: { documentStatus: true, postingStatus: true } },
        },
      }),
      db.supplierBill.findMany({
        where: { organizationId, purchaseOrderId },
        select: {
          totalAmount: true,
          postingStatus: true,
          documentStatus: true,
          allocations: {
            select: {
              allocatedAmount: true,
              postingStatus: true,
              payment: {
                select: {
                  documentStatus: true,
                  postingStatus: true,
                  purchaseAllocations: { where: { purchaseOrderId }, select: { id: true } },
                },
              },
            },
          },
        },
      }),
    ]);
    const paymentLive = (p: { documentStatus: string; postingStatus: string }) =>
      p.documentStatus !== 'CANCELLED' && p.documentStatus !== 'REJECTED' && p.postingStatus !== 'REVERSED';
    return {
      ordered,
      postedBillsTotal: bills
        .filter((b) => b.postingStatus === 'POSTED')
        .reduce((s, b) => s.add(dec(b.totalAmount)), new Decimal(0)),
      advances: advances.map((a) => ({
        amount: dec(a.amount),
        returned: a.returns.reduce((s, r) => s.add(dec(r.amount)), new Decimal(0)),
        live: a.documentStatus !== 'CANCELLED' && a.documentStatus !== 'REJECTED' && a.postingStatus !== 'REVERSED',
      })),
      purchaseAllocations: purchaseAllocations.map((a) => ({
        amount: dec(a.allocatedAmount),
        live: paymentLive(a.supplierPayment),
      })),
      billAllocations: bills.flatMap((b) =>
        b.allocations.map((a) => ({
          amount: dec(a.allocatedAmount),
          live: a.postingStatus !== 'REVERSED' && paymentLive(a.payment),
          paymentFundsPoDirectly: a.payment.purchaseAllocations.length > 0,
        })),
      ),
    };
  }

  /** The STAFF_ADVANCE profile version in force on `date` (null = not configured). */
  async staffAdvanceAccount(db: Db, organizationId: string, date: Date): Promise<StaffAdvanceAccount | null> {
    const profile = await db.postingProfile.findFirst({
      where: { organizationId, code: STAFF_ADVANCE_PROFILE_CODE, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!profile) return null;
    const version = await db.postingProfileVersion.findFirst({
      where: {
        postingProfileId: profile.id,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      select: { id: true, accountId: true, versionNumber: true },
    });
    return version ? { accountId: version.accountId, versionId: version.id, versionNumber: version.versionNumber } : null;
  }

  /** Bank / cash / mobile-money accounts with their GL and active signatory count. */
  async paymentAccounts(db: Db, organizationId: string, currencyCode?: string) {
    const accounts = await db.bankAccount.findMany({
      where: { organizationId, ...(currencyCode ? { currencyCode } : {}) },
      select: {
        id: true,
        bankName: true,
        accountName: true,
        currencyCode: true,
        status: true,
        allowsPayments: true,
        allowsReceipts: true,
        glAccountId: true,
        glAccount: { select: { code: true } },
        signatories: { where: { isActive: true }, select: { id: true } },
      },
      orderBy: [{ bankName: 'asc' }, { accountName: 'asc' }],
    });
    return accounts.map(({ signatories, glAccount, ...a }) => ({
      ...a,
      glCode: glAccount.code,
      activeSignatories: signatories.length,
    }));
  }

  findPaymentAccount(db: Db, organizationId: string, bankAccountId: string) {
    return this.paymentAccounts(db, organizationId).then((all) => all.find((a) => a.id === bankAccountId) ?? null);
  }

  /** The account the user last released buyer cash from (prefill), if any. */
  async lastAdvanceAccountId(db: Db, organizationId: string, userId: string): Promise<string | null> {
    const last = await db.buyerAdvance.findFirst({
      where: { organizationId, createdBy: userId },
      orderBy: { createdAt: 'desc' },
      select: { disbursementBankAccountId: true },
    });
    return last?.disbursementBankAccountId ?? null;
  }

  /** The account the user last paid a supplier from (prefill), if any. */
  async lastPaymentAccountId(db: Db, organizationId: string, userId: string): Promise<string | null> {
    const last = await db.supplierPayment.findFirst({
      where: { organizationId, createdBy: userId },
      orderBy: { createdAt: 'desc' },
      select: { bankAccountId: true },
    });
    return last?.bankAccountId ?? null;
  }

  /** Is the user an ACTIVE member of the organisation (and an ACTIVE user)? With their permissions. */
  async activeMember(db: Db, organizationId: string, userId: string) {
    const membership = await db.organizationMembership.findFirst({
      where: { organizationId, userId, status: 'ACTIVE', removedAt: null, user: { status: 'ACTIVE' } },
      select: {
        user: { select: { id: true, firstName: true, lastName: true } },
        roles: {
          where: { removedAt: null },
          select: { role: { select: { rolePermissions: { select: { permission: { select: { action: true, resource: true } } } } } } },
        },
      },
    });
    if (!membership) return null;
    const permissions = new Set(
      membership.roles.flatMap((r) => r.role.rolePermissions.map((rp) => `${rp.permission.action}:${rp.permission.resource}`)),
    );
    return { id: membership.user.id, name: `${membership.user.firstName} ${membership.user.lastName}`.trim(), permissions };
  }

  /** Accepted quantity per PO line over POSTED goods receipts. */
  async acceptedByPoLine(db: Db, purchaseOrderId: string): Promise<Map<string, Decimal>> {
    const lines = await db.goodsReceiptLine.findMany({
      where: { grn: { purchaseOrderId, status: 'POSTED' } },
      select: { purchaseOrderLineId: true, acceptedQuantity: true },
    });
    const byLine = new Map<string, Decimal>();
    for (const l of lines) byLine.set(l.purchaseOrderLineId, (byLine.get(l.purchaseOrderLineId) ?? new Decimal(0)).add(dec(l.acceptedQuantity)));
    return byLine;
  }

  /** Quantity already billed per PO line by live (not rejected/cancelled/reversed) bills, via the match. */
  async billedByPoLine(db: Db, purchaseOrderId: string, excludeBillId?: string): Promise<Map<string, Decimal>> {
    const bills = await db.supplierBill.findMany({
      where: {
        purchaseOrderId,
        documentStatus: { notIn: ['REJECTED', 'CANCELLED'] },
        postingStatus: { not: 'REVERSED' },
        ...(excludeBillId ? { id: { not: excludeBillId } } : {}),
      },
      select: { id: true },
    });
    const rows = bills.length
      ? await db.supplierBillMatchLine.findMany({
          where: { billMatch: { supplierBillId: { in: bills.map((b) => b.id) } } },
          select: { purchaseOrderLineId: true, billedQuantity: true },
        })
      : [];
    const byLine = new Map<string, Decimal>();
    for (const r of rows) {
      if (!r.purchaseOrderLineId) continue;
      byLine.set(r.purchaseOrderLineId, (byLine.get(r.purchaseOrderLineId) ?? new Decimal(0)).add(dec(r.billedQuantity)));
    }
    return byLine;
  }

  /** The AP account a posted bill credited (its EVT-AP-001 AP-subledger line), if it has a journal. */
  async billApAccountId(db: Db, journalEntryId: string | null): Promise<string | null> {
    if (!journalEntryId) return null;
    const line = await db.journalLine.findFirst({
      where: { journalEntryId, sourceSubledgerType: 'ACCOUNTS_PAYABLE', creditAmount: { gt: 0 } },
      select: { accountId: true },
    });
    return line?.accountId ?? null;
  }
}
