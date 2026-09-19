import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { Decimal } from '@prisma/client/runtime/library';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { SettlementQueryRepository } from '../infrastructure/settlement-query.repository.js';

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
  ) {}

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
      const settled = b.allocations.reduce(
        (sum, a) => sum.add(a.allocatedAmount as Decimal),
        new Decimal(0),
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
      const evidenceAllocated = a.evidenceAllocations.reduce(
        (sum, e) => sum.add(e.allocatedAmount as Decimal),
        new Decimal(0),
      );
      const returned = a.returns.reduce(
        (sum, r) => sum.add(r.amount as Decimal),
        new Decimal(0),
      );
      const outstanding = (a.amount as Decimal).sub(evidenceAllocated).sub(returned);

      return {
        advanceId: a.id,
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
    const totalFunded = totalDirectAllocated.add(totalAdvanced);

    // ── Funding status ──────────────────────────────────────────────────────────
    const fundingStatus: FundingStatus =
      orderedAmount.greaterThan(0) && totalFunded.greaterThanOrEqualTo(orderedAmount)
        ? 'FUNDED'
        : totalFunded.greaterThan(0)
          ? 'PARTIALLY_FUNDED'
          : 'NOT_FUNDED';

    // ── Per-line receiving ──────────────────────────────────────────────────────
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

    const receivingStatus: ReceivingStatus = receivingLines.every(
      (l) => l.lineStatus === 'RECEIVED',
    )
      ? 'RECEIVED'
      : receivingLines.some((l) => l.lineStatus !== 'NOT_RECEIVED')
        ? 'PARTIALLY_RECEIVED'
        : 'NOT_RECEIVED';

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

    if (orderedAmount.greaterThan(0) && totalFunded.lessThan(orderedAmount)) {
      exceptions.push({
        type: 'FUNDING_GAP',
        detail: `Ordered ${orderedAmount.toFixed(2)} but only ${totalFunded.toFixed(2)} funded. Attach a payment or advance to close the gap.`,
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
      receivingStatus,
      receivingLines,
      settlementStatus,
      exceptions,
      humanReadablePosition,
    };
  }
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
