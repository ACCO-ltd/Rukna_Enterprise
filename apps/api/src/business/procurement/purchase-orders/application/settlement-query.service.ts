import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PurchaseOrderBillPaymentsResponse, RequestIdentity } from '@erp/types';
import { Decimal } from '@prisma/client/runtime/library';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { SettlementQueryRepository } from '../infrastructure/settlement-query.repository.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import {
  billPaymentState,
  summarizeBillPayments,
} from '../../../accounting/accounts-payable/domain/supplier-bill-eligibility.policy.js';

type FundingStatus = 'NOT_FUNDED' | 'PARTIALLY_FUNDED' | 'FUNDED';
type ReceivingStatus = 'NOT_RECEIVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED';
type LineReceivingStatus = 'NOT_RECEIVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED';
type SettlementStatus = 'OPEN' | 'ACTION_REQUIRED' | 'SETTLED';
type ExceptionType = 'QUANTITY_EXCEEDS_PO' | 'OUTSTANDING_ADVANCE' | 'FUNDING_GAP' | 'EVIDENCE_MISSING';

@Injectable()
export class SettlementQueryService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: SettlementQueryRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /**
   * Project access for a PO read by a person (ADR-043 review M2). A PO carries its projects per
   * line. `every` (money reads: settlement, bill payments) — the caller must see every project the
   * PO is coded to; `any` (receiving, no money) — one of them is enough, so a site team on one
   * project of a multi-project PO keeps receiving. Bypass roles always pass; a PO with no project
   * lines is org-level and needs only the endpoint's permission. 404 outside the organisation.
   * Internal callers (auto-close) skip this.
   */
  async assertCanRead(
    identity: RequestIdentity,
    purchaseOrderId: string,
    mode: 'every' | 'any' = 'every',
  ): Promise<void> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    if (!(await this.repo.purchaseOrderExists(prisma, orgId, purchaseOrderId))) {
      throw new NotFoundException(`Purchase order ${purchaseOrderId} not found`);
    }
    const projectIds = await this.repo.findPoProjectIds(prisma, orgId, purchaseOrderId);
    if (mode === 'any') {
      if (projectIds.length === 0) return;
      const accessible = await this.projectAccess.accessibleProjectIds(identity);
      if (accessible === undefined || projectIds.some((id) => accessible.includes(id))) return;
      throw new ForbiddenException('You are not a member of any project on this purchase order.');
    }
    for (const projectId of projectIds) {
      await this.projectAccess.assertMember(identity, projectId);
    }
  }

  /** The settlement read model for a person: project access first, then `getSettlement`. */
  async getSettlementForViewer(identity: RequestIdentity, purchaseOrderId: string) {
    await this.assertCanRead(identity, purchaseOrderId);
    return this.getSettlement(identity, purchaseOrderId);
  }

  /**
   * Receiving only — ordered vs accepted quantity per line, no money (ADR-043 review M2). The
   * Receiving tab reads this so money-blind roles keep it while the settlement read is gated on
   * cost visibility. Same per-line rule as the settlement read (`receivingPosition`).
   */
  async getReceiving(identity: RequestIdentity, purchaseOrderId: string) {
    await this.assertCanRead(identity, purchaseOrderId, 'any');
    const prisma = this.tenancy.getClient();
    const po = await this.repo.findPoForSettlement(prisma, identity.activeOrganizationId, purchaseOrderId);
    if (!po) throw new NotFoundException(`Purchase order ${purchaseOrderId} not found`);
    const { byLine } = await this.repo.receivedByPoLine(prisma, purchaseOrderId);
    return receivingPosition(po.revisions.find((r) => r.status === 'ACTIVE'), byLine);
  }

  /**
   * ADR-043 decision 4 — the payment status of this PO's supplier bills, amounts included, for the
   * Procurement Manager (who negotiated the prices). A record only: no payment command is reachable
   * from it. Paid / pending use the bill page's own rule (`summarizeBillPayments`); outstanding is
   * the bill's stored balance (the bills list's figure). The controller gates it on
   * `view:procurement` + `view:commitment-ledger`, so Project Managers and Site Engineers (who hold
   * no cost visibility) stay blind; project access applies to every project the PO is coded to.
   */
  async getBillPayments(
    identity: RequestIdentity,
    purchaseOrderId: string,
  ): Promise<PurchaseOrderBillPaymentsResponse> {
    await this.assertCanRead(identity, purchaseOrderId);
    const prisma = this.tenancy.getClient();
    const bills = await this.repo.findBillPaymentsForPo(prisma, identity.activeOrganizationId, purchaseOrderId);
    return {
      purchaseOrderId,
      bills: bills.map((bill) => {
        const summary = summarizeBillPayments(
          bill.allocations.map((a) => ({
            allocatedAmount: a.allocatedAmount.toString(),
            postingStatus: a.postingStatus,
            paymentId: a.supplierPaymentId,
            paymentDate: a.payment.paymentDate,
          })),
        );
        // ADR-045 — buyer cash applied to the bill counts as paid (dated the application date).
        const applications = bill.advanceEvidenceAllocations ?? [];
        const byCash = applications
          .filter((x) => x.postingStatus === 'POSTED')
          .reduce((s, x) => s.add(x.allocatedAmount as Decimal), new Decimal(0));
        summary.paid = summary.paid.add(byCash);
        for (const x of applications) {
          const day = x.postingStatus === 'POSTED' && x.allocationDate ? x.allocationDate.toISOString().slice(0, 10) : null;
          if (day && (!summary.lastPaymentDate || day > summary.lastPaymentDate)) summary.lastPaymentDate = day;
        }
        return {
          billId: bill.id,
          billNumber: bill.billNumber ?? null,
          supplierInvoiceNumber: bill.supplierInvoiceNumber,
          billDate: bill.billDate.toISOString().slice(0, 10),
          dueDate: bill.dueDate.toISOString().slice(0, 10),
          currencyCode: bill.currencyCode,
          documentStatus: bill.documentStatus,
          postingStatus: bill.postingStatus,
          totalAmount: new Decimal(bill.totalAmount.toString()).toFixed(2),
          paidAmount: summary.paid.toFixed(2),
          pendingAmount: summary.pending.toFixed(2),
          outstandingAmount: new Decimal(bill.outstandingAmount.toString()).toFixed(2),
          lastPaymentDate: summary.lastPaymentDate,
          paymentStatus: billPaymentState(bill, { ...summary, paidByBuyerCash: byCash }),
          paidByBuyerCashAmount: byCash.toFixed(2),
          advanceApplications: applications.map((x) => ({
            advanceId: x.buyerAdvanceId,
            amount: new Decimal(x.allocatedAmount.toString()).toFixed(2),
            allocationDate: x.allocationDate ? x.allocationDate.toISOString().slice(0, 10) : null,
            postingStatus: x.postingStatus,
          })),
        };
      }),
    };
  }

  async getSettlement(identity: RequestIdentity, purchaseOrderId: string) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const [po, allocations, bills, advances] = await Promise.all([
      this.repo.findPoForSettlement(prisma, orgId, purchaseOrderId),
      this.repo.findPurchaseAllocations(prisma, orgId, purchaseOrderId),
      this.repo.findBillsForPo(prisma, orgId, purchaseOrderId),
      this.repo.findBuyerAdvances(prisma, orgId, purchaseOrderId),
    ]);

    if (!po) throw new NotFoundException(`Purchase order ${purchaseOrderId} not found`);

    const activeRevision = po.revisions.find((r) => r.status === 'ACTIVE');
    const { byLine: receivedByLine, hasOverReceipt } = await this.repo.receivedByPoLine(
      prisma,
      purchaseOrderId,
    );

    // Resolve recipient names for advances
    const recipientIds = advances.map((a) => a.recipientUserId);
    const users = await this.repo.findUsers(prisma, orgId, recipientIds);
    const userMap = new Map<string, string>(
      users.map((u) => [u.id, `${u.firstName} ${u.lastName}`] as [string, string]),
    );

    // ── Ordered amount ──────────────────────────────────────────────────────────
    const orderedAmount = activeRevision
      ? activeRevision.lines.reduce(
          (sum, l) => sum.add(l.extendedAmount as Decimal),
          new Decimal(0),
        )
      : new Decimal(0);

    // ── Direct funding ──────────────────────────────────────────────────────────
    const totalDirectAllocated = allocations.reduce(
      (sum, a) => sum.add(a.allocatedAmount as Decimal),
      new Decimal(0),
    );

    const billRows = bills.map((b) => {
      // ADR-045 — settled = payment allocations (not reversed) + POSTED buyer-cash applications.
      const settled = b.allocations
        .filter((a) => a.postingStatus !== 'REVERSED')
        .reduce((sum, a) => sum.add(a.allocatedAmount as Decimal), new Decimal(0))
        .add(
          b.advanceEvidenceAllocations
            .filter((a) => a.postingStatus === 'POSTED')
            .reduce((sum, a) => sum.add(a.allocatedAmount as Decimal), new Decimal(0)),
        );
      return {
        billId: b.id,
        billNumber: b.billNumber ?? null,
        totalAmount: b.totalAmount as Decimal,
        settledAmount: settled,
        outstandingAmount: b.outstandingAmount as Decimal,
      };
    });
    const totalBillSettled = billRows.reduce((sum, b) => sum.add(b.settledAmount), new Decimal(0));

    // ── Advance funding ─────────────────────────────────────────────────────────
    const advanceRows = advances.map((a) => {
      // ADR-045 — a posted advance is accounted for by its POSTED applications; a legacy advance
      // (posted before GL posting, no journal) keeps the evidence arithmetic and is labelled.
      const legacy = a.postedJournalEntryId === null;
      const evidenceAllocated = a.evidenceAllocations
        .filter((e) => legacy || e.postingStatus === 'POSTED')
        .reduce((sum, e) => sum.add(e.allocatedAmount as Decimal), new Decimal(0));
      const returned = a.returns.reduce(
        (sum, r) => sum.add(r.amount as Decimal),
        new Decimal(0),
      );
      const outstanding = (a.amount as Decimal).sub(evidenceAllocated).sub(returned);

      return {
        advanceId: a.id,
        legacy,
        label: legacy ? 'Recorded before GL posting' : null,
        recipientName: userMap.get(a.recipientUserId) ?? a.recipientUserId,
        amount: a.amount as Decimal,
        advancedAt: a.advancedAt,
        evidenceAllocated,
        returned,
        outstanding: outstanding.lessThan(0) ? new Decimal(0) : outstanding,
        returns: a.returns.map((r) => ({
          amount: r.amount as Decimal,
          returnMethod: r.returnMethod,
          receivedAt: r.receivedAt,
        })),
        evidenceAllocations: a.evidenceAllocations.map((e) => ({
          billId: e.supplierBillId,
          billNumber: e.supplierBill.billNumber ?? null,
          allocatedAmount: e.allocatedAmount as Decimal,
        })),
      };
    });

    const totalAdvanced = advanceRows.reduce((sum, a) => sum.add(a.amount), new Decimal(0));
    const totalOutstanding = advanceRows.reduce((sum, a) => sum.add(a.outstanding), new Decimal(0));
    // ADR-045 — a bill paid directly by a payment that does not also fund the PO is funding too
    // (FINANCE_PAYS_SUPPLIER "pay the invoice"); a prepayment applied to the bill is counted once.
    const paidViaBills = bills.reduce(
      (sum, b) =>
        sum.add(
          b.allocations
            .filter((x) => x.postingStatus === 'POSTED' && x.payment.postingStatus === 'POSTED' && x.payment.purchaseAllocations.length === 0)
            .reduce((s, x) => s.add(x.allocatedAmount as Decimal), new Decimal(0)),
        ),
      new Decimal(0),
    );
    const totalFunded = totalDirectAllocated.add(totalAdvanced).add(paidViaBills);
    // ADR-045 Q3 — a posted bill above the order (approved price exception) must be funded in full.
    const postedBillsTotal = bills
      .filter((b) => b.postingStatus === 'POSTED')
      .reduce((sum, b) => sum.add(b.totalAmount as Decimal), new Decimal(0));
    const fundingTarget = postedBillsTotal.greaterThan(orderedAmount) ? postedBillsTotal : orderedAmount;

    // ── Funding status ──────────────────────────────────────────────────────────
    const fundingStatus: FundingStatus =
      fundingTarget.greaterThan(0) && totalFunded.greaterThanOrEqualTo(fundingTarget)
        ? 'FUNDED'
        : totalFunded.greaterThan(0)
          ? 'PARTIALLY_FUNDED'
          : 'NOT_FUNDED';

    // ── Per-line receiving ──────────────────────────────────────────────────────
    const { receivingLines, receivingStatus } = receivingPosition(activeRevision, receivedByLine);

    // ── Evidence block ──────────────────────────────────────────────────────────
    // All supplier bills associated with this PO — independent of payment method.
    // This is the evidence that money was actually spent and a formal invoice exists.
    // The BuyerAdvanceEvidenceAllocation picker on the frontend uses this list.
    const totalEvidence = bills.reduce(
      (sum, b) => sum.add(b.totalAmount as Decimal),
      new Decimal(0),
    );
    const evidenceBills = bills.map((b) => ({
      billId: b.id,
      billNumber: b.billNumber ?? null,
      totalAmount: b.totalAmount as Decimal,
      status: b.postingStatus,
    }));

    // ── Exceptions ──────────────────────────────────────────────────────────────
    const exceptions: Array<{ type: ExceptionType; detail: string }> = [];

    if (hasOverReceipt) {
      exceptions.push({
        type: 'QUANTITY_EXCEEDS_PO',
        detail: 'One or more GRNs recorded quantities above the ordered amount.',
      });
    }

    for (const adv of advanceRows) {
      if (adv.outstanding.greaterThan(0)) {
        exceptions.push({
          type: 'OUTSTANDING_ADVANCE',
          detail: `Advance to ${adv.recipientName} (${adv.amount.toFixed(2)}) has ${adv.outstanding.toFixed(2)} outstanding — attach evidence or record return.`,
        });
      }
    }

    if (fundingTarget.greaterThan(0) && totalFunded.lessThan(fundingTarget)) {
      exceptions.push({
        type: 'FUNDING_GAP',
        detail: `Ordered ${fundingTarget.toFixed(2)} but only ${totalFunded.toFixed(2)} funded. Attach a payment or advance to close the gap.`,
      });
    }

    // A PO cannot settle without at least one formal supplier document (invoice or receipt).
    // Even when fully funded and fully received, the absence of a supplier bill means ACCO
    // has no evidence trail that the supplier delivered and invoiced — required for AP reconciliation.
    if (bills.length === 0 && (fundingStatus === 'FUNDED' || receivingStatus === 'RECEIVED')) {
      exceptions.push({
        type: 'EVIDENCE_MISSING',
        detail: 'Invoice or receipt required before settlement — no supplier bill is linked to this PO.',
      });
    }

    // ── Settlement status ───────────────────────────────────────────────────────
    const isSettled =
      receivingStatus === 'RECEIVED' &&
      exceptions.length === 0 &&
      fundingStatus === 'FUNDED';

    const settlementStatus: SettlementStatus = isSettled
      ? 'SETTLED'
      : exceptions.length > 0
        ? 'ACTION_REQUIRED'
        : 'OPEN';

    // ── Human-readable position ─────────────────────────────────────────────────
    const humanReadablePosition = buildPositionSentence(
      settlementStatus,
      receivingStatus,
      fundingStatus,
      orderedAmount,
      totalFunded,
      exceptions,
    );

    return {
      orderedAmount,
      fundingStatus,
      directFunding: {
        totalAllocated: totalDirectAllocated,
        allocations: allocations.map((a) => ({
          paymentId: a.supplierPaymentId,
          paymentRef: a.supplierPayment.paymentNumber ?? null,
          allocatedAmount: a.allocatedAmount as Decimal,
          allocationDate: a.allocationDate,
        })),
        totalBillSettled,
        bills: billRows,
      },
      advanceFunding: {
        advances: advanceRows,
        totalAdvanced,
        totalOutstanding,
      },
      // All supplier bills linked to this PO — used as evidence of supplier delivery.
      // Independent of directFunding.bills (which are about AP cash settlement);
      // this block contains ALL bills regardless of payment method.
      evidence: {
        totalEvidence,
        bills: evidenceBills,
      },
      receivingStatus,
      receivingLines,
      settlementStatus,
      exceptions,
      humanReadablePosition,
    };
  }
}

type ActiveRevision = {
  lines: Array<{ id: string; description: string; orderedQuantity: unknown }>;
};

/** Ordered vs accepted quantity per line of the active revision, and the PO's receiving status. */
function receivingPosition(activeRevision: ActiveRevision | undefined, receivedByLine: Map<string, Decimal>) {
  const receivingLines = (activeRevision?.lines ?? []).map((line) => {
    const accepted = receivedByLine.get(line.id) ?? new Decimal(0);
    const ordered = line.orderedQuantity as Decimal;
    const lineStatus: LineReceivingStatus = accepted.greaterThanOrEqualTo(ordered)
      ? 'RECEIVED'
      : accepted.greaterThan(0)
        ? 'PARTIALLY_RECEIVED'
        : 'NOT_RECEIVED';

    return {
      poLineId: line.id,
      description: line.description,
      orderedQuantity: ordered,
      uomSymbol: (line as unknown as { uom: { symbol: string } }).uom?.symbol ?? '',
      acceptedQuantity: accepted,
      lineStatus,
    };
  });

  const receivingStatus: ReceivingStatus = receivingLines.every((l) => l.lineStatus === 'RECEIVED')
    ? 'RECEIVED'
    : receivingLines.some((l) => l.lineStatus !== 'NOT_RECEIVED')
      ? 'PARTIALLY_RECEIVED'
      : 'NOT_RECEIVED';

  return { receivingStatus, receivingLines };
}

function buildPositionSentence(
  status: SettlementStatus,
  receiving: ReceivingStatus,
  funding: FundingStatus,
  ordered: Decimal,
  funded: Decimal,
  exceptions: Array<{ type: string }>,
): string {
  if (status === 'SETTLED') return 'All goods received and funds accounted for — purchase order settled.';
  if (status === 'ACTION_REQUIRED') {
    const types = exceptions.map((e) => e.type);
    if (types.includes('EVIDENCE_MISSING')) return 'Invoice required — attach a supplier bill before this PO can settle.';
    if (types.includes('OUTSTANDING_ADVANCE')) return 'Advance outstanding — attach evidence or record return to settle.';
    if (types.includes('QUANTITY_EXCEEDS_PO')) return 'Received quantity exceeds ordered — review before closing.';
    if (types.includes('FUNDING_GAP')) return `Funding gap of ${ordered.sub(funded).toFixed(2)} — attach payment or advance.`;
    return 'Action required to complete settlement.';
  }
  if (receiving === 'NOT_RECEIVED') return 'Awaiting goods delivery.';
  if (receiving === 'PARTIALLY_RECEIVED') return 'Partially received — awaiting remaining delivery.';
  if (funding === 'NOT_FUNDED') return 'Goods received but no funding recorded yet.';
  return 'In progress.';
}
