import { Injectable } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { loadActorNames } from '../../../../platform/users/application/actor-names.js';
import {
  GoodsReceiptListRepository,
  type GoodsReceiptListFilters,
} from '../infrastructure/goods-receipt-list.repository.js';

/**
 * `GET /procurement/goods-receipts` rows. Backward compatible: the GRN header and its `lines` are
 * kept as before; `supplier`, `purchaseOrder`, `project`, `projectCount` and `deliveredBy` are
 * added. Quantities only — a GRN carries no prices.
 */
@Injectable()
export class GoodsReceiptListService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: GoodsReceiptListRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async list(identity: RequestIdentity, filters: GoodsReceiptListFilters = {}) {
    const prisma = this.tenancy.getClient();
    const grns = await this.repo.findForList(
      prisma,
      identity.activeOrganizationId,
      filters,
      await this.projectAccess.accessibleProjectIds(identity),
    );
    const name = await loadActorNames(prisma, grns.map((g) => g.createdBy));

    return grns.map((grn) => {
      const projects = new Map<string, { id: string; code: string; name: string }>();
      for (const l of grn.lines) if (l.poLine.project) projects.set(l.poLine.project.id, l.poLine.project);
      const first = projects.values().next().value ?? null;
      return {
        ...grn,
        lines: grn.lines.map(({ poLine: _poLine, ...line }) => {
          void _poLine;
          return line;
        }),
        supplier: grn.supplier,
        purchaseOrder: { id: grn.purchaseOrder.id, number: grn.purchaseOrder.poNumber },
        project: first ? { id: first.id, code: first.code, name: first.name } : null,
        projectCount: projects.size,
        /** The person who recorded the receipt (GRN createdBy). */
        deliveredBy: { id: grn.createdBy, name: name(grn.createdBy) },
      };
    });
  }
}
