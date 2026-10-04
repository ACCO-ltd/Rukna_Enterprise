import { Injectable } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { Decimal } from '@prisma/client/runtime/library';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import {
  PurchaseOrderListRepository,
  type PurchaseOrderListFilters,
} from '../infrastructure/purchase-order-list.repository.js';
import { canSeeProcurementMoney, moneyOrNull } from '../../shared/procurement-money.js';

export type PoDeliveryStatus = 'NOT_RECEIVED' | 'PARTLY_RECEIVED' | 'RECEIVED';

/**
 * `GET /procurement/purchase-orders` row. Backward compatible: the previous fields (the PO header,
 * `supplier`, and `revisions` = the latest revision without lines) are kept; the read-model
 * fields below are added.
 */
export interface PurchaseOrderListFields {
  /** First project the describing revision's lines are coded to; null for an org-level PO. */
  project: { id: string; code: string; name: string } | null;
  /** Distinct projects on the describing revision (the UI shows "first + N more"). */
  projectCount: number;
  /** Σ qty × unit price of the ACTIVE revision, else the DRAFT, else the latest. Null when money is hidden. */
  total: string | null;
  currencyCode: string | null;
  /** Accepted vs ordered across the ACTIVE revision's lines; null for DRAFT / CANCELLED POs. */
  deliveryStatus: PoDeliveryStatus | null;
  activeRevisionNumber: number | null;
  /** Status of the latest revision — DRAFT on an OPEN PO means an amendment is pending. */
  revisionStatus: string | null;
  moneyVisible: boolean;
}

@Injectable()
export class PurchaseOrderListService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: PurchaseOrderListRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async list(identity: RequestIdentity, filters: PurchaseOrderListFilters = {}) {
    const prisma = this.tenancy.getClient();
    if (filters.projectId) await this.projectAccess.assertMember(identity, filters.projectId);
    const moneyVisible = canSeeProcurementMoney(identity);

    const pos = await this.repo.findForList(
      prisma,
      identity.activeOrganizationId,
      filters,
      await this.projectAccess.accessibleProjectIds(identity),
    );
    const activeLineIds = pos.flatMap(
      (po) => po.revisions.find((r) => r.status === 'ACTIVE')?.lines.map((l) => l.id) ?? [],
    );
    const accepted = await this.repo.acceptedByLine(prisma, activeLineIds);

    return pos.map((po) => {
      const latest = po.revisions[0];
      const active = po.revisions.find((r) => r.status === 'ACTIVE');
      const draft = po.revisions.find((r) => r.status === 'DRAFT');
      const describing = active ?? draft ?? latest;

      const projects = new Map<string, { id: string; code: string; name: string }>();
      for (const l of describing?.lines ?? []) if (l.project) projects.set(l.project.id, l.project);
      const total = describing
        ? describing.lines.reduce(
            (sum, l) => sum.add((l.unitPrice as Decimal).mul(l.orderedQuantity as Decimal)),
            new Decimal(0),
          )
        : null;

      let deliveryStatus: PoDeliveryStatus | null = null;
      if (active && po.status !== 'DRAFT' && po.status !== 'CANCELLED') {
        const ratios = active.lines.map((l) => ({
          ordered: l.orderedQuantity as Decimal,
          accepted: accepted.get(l.id) ?? new Decimal(0),
        }));
        deliveryStatus = ratios.every((r) => r.accepted.greaterThanOrEqualTo(r.ordered))
          ? 'RECEIVED'
          : ratios.some((r) => r.accepted.greaterThan(0))
            ? 'PARTLY_RECEIVED'
            : 'NOT_RECEIVED';
      }

      // Keep the old row shape: `revisions` is the latest revision only, without lines (no prices).
      const { revisions: _all, ...header } = po;
      const { lines: _lines, ...latestHeader } = latest ?? ({ lines: [] } as never);
      void _all;
      void _lines;

      const fields: PurchaseOrderListFields = {
        project: projects.values().next().value ?? null,
        projectCount: projects.size,
        total: moneyOrNull(moneyVisible, total),
        currencyCode: describing?.currencyCode ?? null,
        deliveryStatus,
        activeRevisionNumber: active?.revisionNumber ?? null,
        revisionStatus: latest?.status ?? null,
        moneyVisible,
      };
      return { ...header, revisions: latest ? [latestHeader] : [], ...fields };
    });
  }
}
