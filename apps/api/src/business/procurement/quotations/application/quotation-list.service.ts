import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { WorkflowTransactionType, type RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { moneyOrNull } from '../../shared/procurement-money.js';
import { distinctCount } from '../domain/quote-count.policy.js';
import { lowestQuoteIds } from '../domain/quote-selection.policy.js';
import { QuotationAccessService } from './quotation-access.service.js';
import { QuotationQueryService, slaOf } from './quotation-query.service.js';

export const QUOTATION_QUEUES = ['collect', 'returned', 'waiting', 'decide', 'awarded', 'all'] as const;
export type QuotationQueue = (typeof QUOTATION_QUEUES)[number];

export interface QuotationListQuery {
  queue?: QuotationQueue;
  projectId?: string;
  /** Free text: QR number, MR number or title, project code or name. */
  q?: string;
  /** Only requests I opened or uploaded a quote to. Default: true for `waiting`, false otherwise. */
  mine?: boolean;
  page?: number;
  limit?: number;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const ROW_SELECT = {
  id: true,
  number: true,
  status: true,
  projectId: true,
  urgent: true,
  sentAt: true,
  createdAt: true,
  estimateAmount: true,
  awardedTotal: true,
  requiredQuoteCount: true,
  exceptionReason: true,
  materialRequest: { select: { id: true, mrNumber: true, title: true } },
  quotes: { select: { id: true, status: true, storeKey: true, enteredTotal: true } },
} satisfies Prisma.QuotationRequestSelect;

/**
 * ADR-044 §12 `GET /procurement/quotation-requests` — the collector's and the selector's queues.
 * A fixed number of queries per page regardless of its size: the candidate ids (the `decide`
 * queue also needs the pending approvals' current step), the page's rows with their quotes and MR,
 * and the page's project labels.
 */
@Injectable()
export class QuotationListService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly projectAccess: ProjectAccessService,
    private readonly commandGovernance: CommandGovernanceService,
    private readonly access: QuotationAccessService,
    private readonly query: QuotationQueryService,
  ) {}

  async list(identity: RequestIdentity, params: QuotationListQuery) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const queue = params.queue ?? 'all';
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(params.limit ?? DEFAULT_LIMIT)));
    const mine = params.mine ?? queue === 'waiting';

    if (params.projectId) await this.projectAccess.assertMember(identity, params.projectId);
    const accessible = await this.projectAccess.accessibleProjectIds(identity);

    const and: Prisma.QuotationRequestWhereInput[] = [{ organizationId: orgId }];
    if (accessible) and.push({ OR: [{ projectId: null }, { projectId: { in: accessible } }] });
    if (params.projectId) and.push({ projectId: params.projectId });
    if (mine) {
      and.push({
        OR: [
          { createdBy: identity.userId },
          { quotes: { some: { uploadedBy: identity.userId } } },
        ],
      });
    }
    const text = params.q?.trim();
    if (text) {
      and.push({
        OR: [
          { number: { contains: text, mode: 'insensitive' } },
          { materialRequest: { mrNumber: { contains: text, mode: 'insensitive' } } },
          { materialRequest: { title: { contains: text, mode: 'insensitive' } } },
          {
            projectId: {
              in: (
                await prisma.project.findMany({
                  where: {
                    organizationId: orgId,
                    OR: [
                      { code: { contains: text, mode: 'insensitive' } },
                      { name: { contains: text, mode: 'insensitive' } },
                    ],
                  },
                  select: { id: true },
                })
              ).map((p) => p.id),
            },
          },
        ],
      });
    }

    switch (queue) {
      case 'collect':
        and.push({ status: 'COLLECTING' });
        break;
      case 'returned':
        and.push({ status: 'RETURNED' });
        break;
      case 'waiting':
        and.push({ status: { in: ['AWAITING_DECISION', 'AWARD_PENDING_APPROVAL'] } });
        break;
      case 'decide':
        and.push({ status: { in: ['AWAITING_DECISION', 'AWARD_PENDING_APPROVAL'] } });
        break;
      case 'awarded':
        and.push({ status: 'AWARDED' });
        and.push({ OR: [{ purchaseOrderId: null }, { purchaseOrder: { status: 'CANCELLED' } }] });
        break;
      case 'all':
        break;
    }

    // Candidate ids in queue order. Waiting queues: oldest send first (the inbox is ordered by
    // waiting time); the others: most recently changed first.
    const waitingOrder = queue === 'decide' || queue === 'waiting';
    let candidates = await prisma.quotationRequest.findMany({
      where: { AND: and },
      select: { id: true, status: true },
      orderBy: waitingOrder ? [{ sentAt: 'asc' }, { createdAt: 'asc' }] : [{ updatedAt: 'desc' }],
    });
    if (queue === 'decide') {
      // A pending award is in my queue only when I hold its current approval step.
      const pendingIds = candidates.filter((c) => c.status === 'AWARD_PENDING_APPROVAL').map((c) => c.id);
      const roles = await this.commandGovernance.pendingStepRoles(WorkflowTransactionType.QUOTATION_AWARD, pendingIds);
      candidates = candidates.filter((c) => {
        if (c.status === 'AWAITING_DECISION') return true;
        const role = roles.get(c.id);
        return role !== undefined && identity.roles.includes(role);
      });
    }

    const total = candidates.length;
    const pageIds = candidates.slice((page - 1) * limit, page * limit).map((c) => c.id);
    const rows = pageIds.length
      ? await prisma.quotationRequest.findMany({ where: { id: { in: pageIds } }, select: ROW_SELECT })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const projectIds = [...new Set(rows.map((r) => r.projectId).filter((v): v is string => Boolean(v)))];
    const projects = new Map(
      (projectIds.length
        ? await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, code: true, name: true } })
        : []
      ).map((p) => [p.id, p] as const),
    );

    const visible = this.access.moneyVisible(identity);
    const now = this.query.now();
    const dec = (v: { toString(): string } | null) => (v === null ? null : new Decimal(v.toString()));

    return {
      items: pageIds.map((id) => {
        const r = byId.get(id)!;
        const quotes = r.quotes.map((q) => ({ id: q.id, status: q.status, enteredTotal: dec(q.enteredTotal) }));
        const lowest = lowestQuoteIds(quotes);
        const lowestTotal = quotes.find((q) => lowest.includes(q.id))?.enteredTotal ?? null;
        return {
          id: r.id,
          number: r.number,
          mr: { id: r.materialRequest.id, number: r.materialRequest.mrNumber, title: r.materialRequest.title },
          project: r.projectId ? (projects.get(r.projectId) ?? null) : null,
          status: r.status,
          quoteCount: r.quotes.filter((q) => q.status === 'ACTIVE').length,
          distinctSupplierCount: distinctCount(r.quotes),
          requiredQuoteCount: r.requiredQuoteCount,
          exceptionReason: r.exceptionReason,
          urgent: r.urgent,
          sentAt: r.sentAt,
          ...slaOf(r, now),
          estimateAmount: moneyOrNull(visible, dec(r.estimateAmount)),
          lowestTotal: moneyOrNull(visible, lowestTotal),
          awardedTotal: moneyOrNull(visible, dec(r.awardedTotal)),
          moneyVisible: visible,
        };
      }),
      page,
      limit,
      total,
    };
  }
}
