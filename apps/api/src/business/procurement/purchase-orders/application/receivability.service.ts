import { Injectable } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { Decimal } from '@prisma/client/runtime/library';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { SegregationOfDutiesService } from '../../../../platform/workflows/application/segregation-of-duties.service.js';
import { ReceivabilityRepository } from '../infrastructure/receivability.repository.js';
import { PurchaseOrderListRepository } from '../infrastructure/purchase-order-list.repository.js';

/** Why the caller cannot receive a PO — the SoD rule code the GRN 403 carries in details.code. */
export type ReceiveBlockedReason = 'PO_CREATOR_CANNOT_RECEIVE_GOODS';

export interface ReceivablePurchaseOrder {
  id: string;
  poNumber: string;
  status: 'OPEN';
  supplier: { id: string; name: string };
  activeRevisionId: string;
  activeRevisionNumber: number;
  expectedDeliveryDate: string | null;
  /** Distinct projects the active revision's lines are coded to (empty = org-level PO). */
  projects: Array<{ id: string; code: string; name: string }>;
  lines: Array<{
    purchaseOrderLineId: string;
    lineNumber: number;
    description: string;
    uomCode: string;
    uomSymbol: string;
    orderedQuantity: string;
    acceptedQuantity: string;
    remainingQuantity: string;
  }>;
  canReceive: boolean;
  blockedReason: ReceiveBlockedReason | null;
  /** The caller's most recent receipt exception on this PO (ADR-022 CONST-DOA-004), if any. */
  receiptException: { id: string; status: string } | null;
}

/**
 * "Which purchase orders can I receive against, and am I allowed to?" — OPEN POs with an ACTIVE
 * revision that still have quantity to receive (ordered − accepted on POSTED receipts, the
 * receiving read model's rule), each with the receiving SoD verdict for the caller. The verdict
 * uses the same SoD service and receipt-exception check GoodsReceiptService enforces at create
 * and post, so a row that says canReceive=false is exactly a receipt that would be refused (403).
 * Quantities only — no prices.
 */
@Injectable()
export class ReceivabilityService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: ReceivabilityRepository,
    private readonly receiving: PurchaseOrderListRepository,
    private readonly sod: SegregationOfDutiesService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async listReceivable(identity: RequestIdentity): Promise<ReceivablePurchaseOrder[]> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const [pos, accessible, sodCodes] = await Promise.all([
      this.repo.findOpenWithActiveRevision(prisma, orgId),
      this.projectAccess.accessibleProjectIds(identity),
      this.sod.activeRuleCodes(orgId),
    ]);

    // Project scoping, receiving's 'any' rule: an org-level PO (no project lines) is visible; a
    // project PO is visible when the caller can access at least one of its projects.
    const visible = pos.filter((po) => {
      const projectIds = (po.revisions[0]?.lines ?? [])
        .map((l) => l.project?.id)
        .filter((id): id is string => Boolean(id));
      return accessible === undefined || projectIds.length === 0 || projectIds.some((id) => accessible.includes(id));
    });

    const lineIds = visible.flatMap((po) => po.revisions[0].lines.map((l) => l.id));
    const poIds = visible.map((po) => po.id);
    const [accepted, exceptions] = await Promise.all([
      this.receiving.acceptedByLine(prisma, lineIds),
      this.repo.findLatestExceptions(prisma, orgId, poIds, identity.userId),
    ]);
    // Newest first: the first row per PO is the one to show; any APPROVED row clears the caller —
    // the rule GoodsReceiptService applies (ReceiptExceptionRepository.hasApprovedException).
    const latestException = new Map<string, { id: string; status: string }>();
    const clearedPoIds = new Set<string>();
    for (const e of exceptions) {
      if (!latestException.has(e.purchaseOrderId)) latestException.set(e.purchaseOrderId, { id: e.id, status: e.status });
      if (e.status === 'APPROVED') clearedPoIds.add(e.purchaseOrderId);
    }

    const rows: ReceivablePurchaseOrder[] = [];
    for (const po of visible) {
      const revision = po.revisions[0];
      const lines = revision.lines.map((l) => {
        const ordered = l.orderedQuantity as Decimal;
        const acc = accepted.get(l.id) ?? new Decimal(0);
        const remaining = Decimal.max(ordered.sub(acc), new Decimal(0));
        return {
          purchaseOrderLineId: l.id,
          lineNumber: l.lineNumber,
          description: l.description,
          uomCode: l.uom.code,
          uomSymbol: l.uom.symbol,
          orderedQuantity: ordered.toString(),
          acceptedQuantity: acc.toString(),
          remainingQuantity: remaining.toString(),
        };
      });
      if (!lines.some((l) => new Decimal(l.remainingQuantity).greaterThan(0))) continue;

      const exception = latestException.get(po.id) ?? null;
      const cleared = clearedPoIds.has(po.id);
      const violated = this.sod.violation(sodCodes, {
        organizationId: orgId,
        action: 'RECEIVE_GOODS',
        actorUserId: identity.userId,
        purchaseOrderCreatorUserId: cleared ? undefined : po.createdBy,
      });

      const projects = new Map<string, { id: string; code: string; name: string }>();
      for (const l of revision.lines) if (l.project) projects.set(l.project.id, l.project);

      rows.push({
        id: po.id,
        poNumber: po.poNumber,
        status: 'OPEN',
        supplier: po.supplier,
        activeRevisionId: revision.id,
        activeRevisionNumber: revision.revisionNumber,
        expectedDeliveryDate: revision.expectedDeliveryDate
          ? revision.expectedDeliveryDate.toISOString().slice(0, 10)
          : null,
        projects: [...projects.values()],
        lines,
        canReceive: violated === null,
        blockedReason: violated === 'PO_CREATOR_CANNOT_RECEIVE_GOODS' ? violated : null,
        receiptException: exception,
      });
    }
    return rows;
  }
}
