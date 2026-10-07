import { Injectable } from '@nestjs/common';
import { PrismaClient, Project, ProjectRole, Prisma } from '@prisma/client';

import {
  ACTIVITY_OUTBOX_RESOURCES,
  ACTIVITY_ROUTES,
  PROJECT_ROW_COMMERCIAL_PREFIX,
  storedRouteForms,
  type ActivityCursor,
  type ActivityFamily,
} from '../domain/project-activity.js';
import type {
  ActivityTargetKind,
  ActivityTargetRecord,
  ActivityTargetRecords,
} from '../domain/project-activity-targets.js';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export const PROJECT_FULL_INCLUDE = {
  members: {
    where: { removedAt: null },
    include: {
      roles: { where: { removedAt: null } },
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  },
  suspensions: { where: { resumedAt: null }, take: 1 },
  // Project type (PTD1-PTD5): the read model surfaces the scalar `category` (comes for free) plus
  // the assigned subtype's id/name/category so the UI can render + edit the classification.
  subtype: { select: { id: true, name: true, category: true, status: true } },
} satisfies Prisma.ProjectInclude;

export type ProjectFull = Prisma.ProjectGetPayload<{ include: typeof PROJECT_FULL_INCLUDE }>;

const PROJECT_LIST_INCLUDE = {
  members: {
    where: { removedAt: null, roles: { some: { role: 'PROJECT_MANAGER', removedAt: null } } },
    take: 1,
    select: { user: { select: { firstName: true, lastName: true } } },
  },
  suspensions: { where: { resumedAt: null }, take: 1, select: { id: true } },
  contracts: {
    where: {
      contractKind: 'CLIENT_CONTRACT',
      status: 'ACTIVE',
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { contractValue: true, currency: true },
  },
} satisfies Prisma.ProjectInclude;

export type ProjectListRecord = Prisma.ProjectGetPayload<{ include: typeof PROJECT_LIST_INCLUDE }>;

const PROJECT_WORKSPACE_SUMMARY_INCLUDE = {
  members: {
    where: { removedAt: null },
    include: {
      roles: { where: { removedAt: null } },
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  boq: {
    select: {
      id: true,
      versions: { select: { status: true } },
    },
  },
  contracts: {
    where: {
      contractKind: 'CLIENT_CONTRACT',
      status: { notIn: ['CLOSED', 'CANCELLED', 'TERMINATED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true,
      contractNumber: true,
      contractValue: true,
      currency: true,
      status: true,
      startDate: true,
      expectedEndDate: true,
    },
  },
  suspensions: { where: { resumedAt: null }, take: 1, select: { id: true } },
} satisfies Prisma.ProjectInclude;

export type ProjectWorkspaceSummaryRecord = Prisma.ProjectGetPayload<{
  include: typeof PROJECT_WORKSPACE_SUMMARY_INCLUDE;
}>;

// ADR-019 CONST-PLC-005/009 — exactly the facts the readiness policy reads: the assigned client's
// status, the effective (non-terminal) client contract's status + start date, whether a BOQ version
// is baselined, and the active member count. Scalars (status, commercialModel, dates, clientId)
// come with the include.
//
// Amendment 2026-09-28 — plus the evidence behind `satisfiedAt`: each version's commit stamp
// (`baselinedAt`), the contract id (its signature events are read from the audit log), and EVERY
// membership row with its join/removal time (removed rows included, so the moment the delivery
// team formed can be reconstructed). The active member count is derived from the same rows.
const PROJECT_READINESS_INCLUDE = {
  client: { select: { status: true } },
  boq: { select: { versions: { select: { status: true, baselinedAt: true } } } },
  contracts: {
    where: {
      contractKind: 'CLIENT_CONTRACT',
      status: { notIn: ['CLOSED', 'CANCELLED', 'TERMINATED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true, status: true, startDate: true },
  },
  members: { select: { id: true, joinedAt: true, removedAt: true } },
} satisfies Prisma.ProjectInclude;

/** Outbox commands that put a contract into ACTIVE (ADR-032 record-signed, or legacy activate). */
const CONTRACT_SIGNATURE_COMMANDS = ['contract.record-signed', 'contract.activate'];

const ACTIVITY_SELECT = {
  id: true,
  action: true,
  resource: true,
  resourceId: true,
  sourceCommand: true,
  // Read only for the ids an invoice/payment command names (`project-activity-targets`: invoice,
  // receipt and installment ids); never sent to the client (a payment's `after` carries its
  // amount). Prisma cannot select JSON sub-keys, so the whole column is loaded and the ids are
  // picked out in the domain module.
  after: true,
  createdAt: true,
  user: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.AuditLogSelect;

export type ProjectActivityRow = Prisma.AuditLogGetPayload<{ select: typeof ACTIVITY_SELECT }>;

export type ProjectReadinessRecord = Prisma.ProjectGetPayload<{
  include: typeof PROJECT_READINESS_INCLUDE;
}>;

@Injectable()
export class ProjectPrismaRepository {
  // ─── Queries ─────────────────────────────────────────────────────────────────

  async findAll(
    prisma: TenantPrisma,
    organizationId: string,
    status?: string,
    userId?: string,
  ): Promise<ProjectListRecord[]> {
    return prisma.project.findMany({
      where: {
        organizationId,
        ...(userId ? { members: { some: { userId, removedAt: null } } } : {}),
        ...(status ? { status: status as Prisma.EnumProjectStatusFilter } : {}),
      },
      include: PROJECT_LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(
    prisma: TenantPrisma,
    organizationId: string,
    id: string,
  ): Promise<ProjectFull | null> {
    return prisma.project.findFirst({
      where: { id, organizationId },
      include: PROJECT_FULL_INCLUDE,
    });
  }

  async findWorkspaceSummary(
    prisma: TenantPrisma,
    organizationId: string,
    id: string,
  ): Promise<ProjectWorkspaceSummaryRecord | null> {
    return prisma.project.findFirst({
      where: { id, organizationId },
      include: PROJECT_WORKSPACE_SUMMARY_INCLUDE,
    });
  }

  async findReadinessSnapshot(
    prisma: TenantPrisma,
    organizationId: string,
    id: string,
  ): Promise<ProjectReadinessRecord | null> {
    return prisma.project.findFirst({
      where: { id, organizationId },
      include: PROJECT_READINESS_INCLUDE,
    });
  }

  /** `findReadinessSnapshot` for a set of projects in one query (the Dashboard's Preparation list). */
  async findReadinessSnapshots(
    prisma: TenantPrisma,
    organizationId: string,
    ids: string[],
  ): Promise<ProjectReadinessRecord[]> {
    if (ids.length === 0) return [];
    return prisma.project.findMany({
      where: { id: { in: ids }, organizationId },
      include: PROJECT_READINESS_INCLUDE,
    });
  }

  /**
   * The effective contract's signature events, newest first: `contract.record-signed` (ADR-032,
   * creates the contract ACTIVE) and `contract.activate` (legacy DRAFT -> ACTIVE). Outbox rows,
   * written in the transaction that changed the status.
   */
  async findContractSignatureEvents(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.auditLog.findMany({
      where: {
        orgId: organizationId,
        resource: 'Contract',
        resourceId: contractId,
        sourceCommand: { in: CONTRACT_SIGNATURE_COMMANDS },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { sourceCommand: true, createdAt: true },
    });
  }

  /**
   * A project's history, newest first (ADR-019 amendment 2026-09-28). `families` is the set the
   * caller may read — decided by the service from permissions; this only turns it into a query.
   * See `domain/project-activity.ts` for which rows can be tied to the project and why.
   */
  async findProjectActivity(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    families: ReadonlySet<ActivityFamily>,
    page: { cursor: ActivityCursor | null; take: number },
  ): Promise<ProjectActivityRow[]> {
    const clauses: Prisma.AuditLogWhereInput[] = [];

    if (families.has('project')) {
      clauses.push({
        resource: { in: [...ACTIVITY_OUTBOX_RESOURCES.project] },
        resourceId: projectId,
        // A project-level payment is a commercial event; it follows the contract family's gate.
        ...(families.has('contract')
          ? {}
          : { NOT: { sourceCommand: { startsWith: PROJECT_ROW_COMMERCIAL_PREFIX } } }),
      });
    }

    if (families.has('contract')) {
      const contracts = await prisma.contract.findMany({
        where: { projectId, organizationId },
        select: {
          id: true,
          paymentInstallments: { select: { id: true } },
          advanceTerms: { select: { id: true } },
          deliverables: { select: { id: true } },
          guarantees: { select: { id: true } },
          variationOrders: { select: { id: true } },
        },
      });
      const ids = contracts.flatMap((c) => [
        c.id,
        ...c.paymentInstallments.map((x) => x.id),
        ...c.advanceTerms.map((x) => x.id),
        ...c.deliverables.map((x) => x.id),
        ...c.guarantees.map((x) => x.id),
        ...c.variationOrders.map((x) => x.id),
      ]);
      if (ids.length > 0) {
        clauses.push({ resource: { in: [...ACTIVITY_OUTBOX_RESOURCES.contract] }, resourceId: { in: ids } });
      }
    }

    if (families.has('documents')) {
      const documents = await prisma.projectDocument.findMany({
        where: { projectId, organizationId },
        select: { id: true, revisions: { select: { id: true } } },
      });
      const ids = documents.flatMap((d) => [d.id, ...d.revisions.map((r) => r.id)]);
      if (ids.length > 0) {
        clauses.push({ resource: { in: [...ACTIVITY_OUTBOX_RESOURCES.documents] }, resourceId: { in: ids } });
      }
    }

    if (families.has('programme')) {
      const baselines = await prisma.programmeBaseline.findMany({
        where: { projectId, organizationId },
        select: { id: true },
      });
      if (baselines.length > 0) {
        clauses.push({
          resource: { in: [...ACTIVITY_OUTBOX_RESOURCES.programme] },
          resourceId: { in: baselines.map((b) => b.id) },
        });
      }
    }

    // Request-logged rows: the stored resource is the route pattern and the id is the project.
    for (const route of ACTIVITY_ROUTES) {
      if (!families.has(route.family)) continue;
      clauses.push({
        resource: { in: storedRouteForms(route.route) },
        action: route.method,
        resourceId: projectId,
        sourceCommand: null,
      });
    }

    if (clauses.length === 0) return [];

    const { cursor, take } = page;
    return prisma.auditLog.findMany({
      where: {
        orgId: organizationId,
        OR: clauses,
        ...(cursor
          ? {
              AND: [
                {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: ACTIVITY_SELECT,
    });
  }

  /**
   * The records that name a page of activity events, one query per kind present
   * (`domain/project-activity-targets.ts`). Every lookup is held to this organisation and — where
   * the record carries it — this project, so an id from another project resolves to nothing.
   */
  async findActivityTargetRecords(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    ids: ReadonlyMap<ActivityTargetKind, readonly string[]>,
  ): Promise<ActivityTargetRecords> {
    const ofContract = { projectId, organizationId };
    const loaders: { [K in ActivityTargetKind]: (ids: string[]) => Promise<[string, ActivityTargetRecord][]> } = {
      contract: async (in_) =>
        (
          await prisma.contract.findMany({
            where: { id: { in: in_ }, ...ofContract },
            select: { id: true, contractNumber: true },
          })
        ).map((r) => [r.id, { reference: r.contractNumber }]),
      installment: async (in_) =>
        (
          await prisma.contractPaymentInstallment.findMany({
            where: { id: { in: in_ }, contract: ofContract },
            select: { id: true, name: true },
          })
        ).map((r) => [r.id, { reference: r.name }]),
      advanceTerm: async (in_) =>
        (
          await prisma.contractAdvanceTerm.findMany({
            where: { id: { in: in_ }, contract: ofContract },
            select: { id: true, description: true },
          })
        ).map((r) => [r.id, { reference: r.description }]),
      deliverable: async (in_) =>
        (
          await prisma.contractDeliverable.findMany({
            where: { id: { in: in_ }, contract: ofContract },
            select: { id: true, name: true },
          })
        ).map((r) => [r.id, { reference: r.name }]),
      guarantee: async (in_) =>
        (
          await prisma.contractGuarantee.findMany({
            where: { id: { in: in_ }, contract: ofContract },
            select: { id: true, reference: true },
          })
        ).map((r) => [r.id, { reference: r.reference }]),
      variation: async (in_) =>
        (
          await prisma.variationOrder.findMany({
            where: { id: { in: in_ }, organizationId, contract: { projectId } },
            select: { id: true, reference: true },
          })
        ).map((r) => [r.id, { reference: r.reference }]),
      document: async (in_) =>
        (
          await prisma.projectDocument.findMany({
            where: { id: { in: in_ }, projectId, organizationId },
            select: { id: true, documentNumber: true },
          })
        ).map((r) => [r.id, { reference: r.documentNumber }]),
      revision: async (in_) =>
        (
          await prisma.projectDocumentRevision.findMany({
            where: { id: { in: in_ }, organizationId, document: { projectId } },
            select: {
              id: true,
              revisionNumber: true,
              revisionCode: true,
              projectDocumentId: true,
              document: { select: { documentNumber: true } },
            },
          })
        ).map((r) => [
          r.id,
          {
            reference: `${r.document.documentNumber} rev. ${r.revisionCode ?? r.revisionNumber}`,
            documentId: r.projectDocumentId,
          },
        ]),
      baseline: async (in_) =>
        (
          await prisma.programmeBaseline.findMany({
            where: { id: { in: in_ }, projectId, organizationId },
            select: { id: true, version: true },
          })
        ).map((r) => [r.id, { reference: `v${r.version}` }]),
      invoice: async (in_) =>
        (
          await prisma.clientInvoice.findMany({
            where: { id: { in: in_ }, projectId, organizationId },
            select: { id: true, invoiceNumber: true },
          })
        ).map((r) => [r.id, { reference: r.invoiceNumber }]),
      // A receipt has no project column: it belongs to this project through its allocations to
      // this project's invoices. A receipt allocated elsewhere only resolves to nothing.
      receipt: async (in_) =>
        (
          await prisma.paymentReceipt.findMany({
            where: {
              id: { in: in_ },
              organizationId,
              clientAllocations: { some: { invoice: { projectId, organizationId } } },
            },
            select: { id: true, receiptNumber: true },
          })
        ).map((r) => [r.id, { reference: r.receiptNumber }]),
    };

    const loaded = await Promise.all(
      [...ids].map(async ([kind, kindIds]) => [kind, new Map(await loaders[kind]([...kindIds]))] as const),
    );
    return new Map(loaded);
  }

  async findByCode(
    prisma: TenantPrisma,
    organizationId: string,
    code: string,
  ): Promise<Project | null> {
    return prisma.project.findUnique({ where: { organizationId_code: { organizationId, code } } });
  }

  // ─── Commands ────────────────────────────────────────────────────────────────

  async create(prisma: TenantPrisma, data: Prisma.ProjectUncheckedCreateInput): Promise<Project> {
    return prisma.project.create({ data });
  }

  /**
   * ADR-025 — allocate a project code `{shortCode}-{districtCode}-{YY}-{seq4}`
   * (e.g. `ACCO-WBR-26-0065`). The sequence is scoped per (org, year): the number
   * counts every project the org started that year, across all districts, and resets
   * with the year. The increment is atomic (upsert), so a concurrent create cannot
   * hand out the same number twice.
   */
  async allocateCode(
    prisma: TenantPrisma,
    organizationId: string,
    year: number,
    shortCode: string,
    districtCode: string,
  ): Promise<string> {
    const sequence = await prisma.projectCodeSequence.upsert({
      where: { organizationId_year: { organizationId, year } },
      create: { organizationId, year, nextValue: 2 },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });
    const allocated = sequence.nextValue - 1;
    const yy = String(year).slice(-2);
    return `${shortCode}-${districtCode}-${yy}-${String(allocated).padStart(4, '0')}`;
  }

  async update(
    prisma: TenantPrisma,
    id: string,
    data: Prisma.ProjectUncheckedUpdateInput,
  ): Promise<Project> {
    return prisma.project.update({ where: { id }, data });
  }

  // ─── Suspension ──────────────────────────────────────────────────────────────

  async createSuspension(prisma: TenantPrisma, data: Prisma.ProjectSuspensionUncheckedCreateInput) {
    return prisma.projectSuspension.create({ data });
  }

  async resolveActiveSuspension(prisma: TenantPrisma, projectId: string, resumedBy: string) {
    return prisma.projectSuspension.updateMany({
      where: { projectId, resumedAt: null },
      data: { resumedAt: new Date(), resumedBy },
    });
  }

  async findActiveSuspension(prisma: TenantPrisma, projectId: string) {
    return prisma.projectSuspension.findFirst({ where: { projectId, resumedAt: null } });
  }

  // ─── Members ─────────────────────────────────────────────────────────────────

  async findActiveMember(prisma: TenantPrisma, projectId: string, userId: string) {
    return prisma.projectMember.findFirst({
      where: { projectId, userId, removedAt: null },
      include: { roles: { where: { removedAt: null } } },
    });
  }

  async findAllMembers(prisma: TenantPrisma, projectId: string) {
    return prisma.projectMember.findMany({
      where: { projectId, removedAt: null },
      include: {
        roles: { where: { removedAt: null } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async createMember(prisma: TenantPrisma, data: Prisma.ProjectMemberUncheckedCreateInput) {
    return prisma.projectMember.create({ data });
  }

  async removeMember(prisma: TenantPrisma, memberId: string, removedBy: string) {
    return prisma.projectMember.update({
      where: { id: memberId },
      data: { removedAt: new Date(), removedBy },
    });
  }

  async addMemberRoles(
    prisma: TenantPrisma,
    memberId: string,
    roles: string[],
    assignedBy: string,
  ) {
    return prisma.projectMemberRole.createMany({
      data: roles.map((role) => ({ memberId, role: role as ProjectRole, assignedBy })),
    });
  }

  /** Closes every currently-active role row for a member (versioned edit — no hard delete). */
  async deactivateMemberRoles(prisma: TenantPrisma, memberId: string) {
    return prisma.projectMemberRole.updateMany({
      where: { memberId, removedAt: null },
      data: { removedAt: new Date() },
    });
  }
}
