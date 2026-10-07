/**
 * ADR-044 test fixture: an isolated procurement org (ProcurementFixtureFactory) plus the people a
 * quotation needs — a requester, two collectors, two selectors, approvers — each with an identity
 * carrying exactly the permissions the real roles hold, and helpers for approved MRs and uploaded
 * photo files. DB-backed; call `cleanupQuotationEnv` in afterAll.
 */
import { createHash, randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import {
  ProcurementFixtureFactory,
  type ProcurementTestEnv,
} from '../../../__tests__/helpers/procurement-fixture.factory.js';
import { cleanupGovernance } from '../../../__tests__/helpers/governance-fixture.js';

export const PERSONAS = [
  'requester',
  'collector',
  'collector2',
  'selector',
  'selector2',
  'cfo',
  'director',
  'pm',
] as const;
export type Persona = (typeof PERSONAS)[number];

const P = PERMISSIONS;

/** The permissions each persona holds — the seeded role sets that matter here. */
export const PERSONA_PERMISSIONS: Record<Persona, string[]> = {
  requester: [P.procurementView, P.materialRequestsCreate, P.materialRequestsSubmit],
  // Procurement Manager.
  collector: [P.procurementView, P.quotationsCollect, P.purchaseOrdersCreate, P.commitmentsView],
  collector2: [P.procurementView, P.quotationsCollect, P.purchaseOrdersCreate, P.commitmentsView],
  // Finance Officer.
  selector: [P.procurementView, P.quotationsAward, P.payablesManage, P.commitmentsView],
  // A selector without manage:payable (e.g. a CEO).
  selector2: [P.procurementView, P.quotationsAward, P.commitmentsView],
  cfo: [P.procurementView, P.quotationsAward, P.commitmentsView],
  // Construction Director: approves the ≤ $100 award band step, does not award.
  director: [P.procurementView, P.commitmentsView],
  // Money-blind Project Manager.
  pm: [P.procurementView],
};

/** The approval-chain role names each persona holds (identity.roles). */
export const PERSONA_ROLES: Record<Persona, string[]> = {
  requester: ['Project Manager'],
  collector: ['Procurement Manager'],
  collector2: ['Procurement Manager'],
  selector: ['Finance Officer'],
  selector2: ['CEO'],
  cfo: ['CFO'],
  director: ['Construction Director'],
  pm: ['Project Manager'],
};

export interface QuotationTestEnv extends ProcurementTestEnv {
  userIds: Record<Persona, string>;
  as: (persona: Persona) => RequestIdentity;
}

export async function createQuotationEnv(prisma: PrismaClient): Promise<QuotationTestEnv> {
  const env = await ProcurementFixtureFactory.create(prisma);
  const userIds = {} as Record<Persona, string>;

  // One org role per persona carrying its permissions, assigned through an ACTIVE membership —
  // the path the notification recipient resolver reads.
  const permissionId = new Map<string, string>();
  for (const key of new Set(Object.values(PERSONA_PERMISSIONS).flat())) {
    const [action, resource] = key.split(':');
    const perm = await prisma.permission.upsert({
      where: { action_resource: { action, resource } },
      create: { action, resource, description: key },
      update: {},
    });
    permissionId.set(key, perm.id);
  }

  for (const persona of PERSONAS) {
    const id = `${env.orgId}-${persona}`;
    userIds[persona] = id;
    await prisma.user.create({
      data: {
        id,
        organizationId: env.orgId,
        email: `${id}@example.test`,
        passwordHash: 'x',
        firstName: persona,
        lastName: 'Tester',
        status: 'ACTIVE',
      },
    });
    const role = await prisma.role.create({
      data: { organizationId: env.orgId, name: `${persona}-role`, description: persona },
    });
    await prisma.rolePermission.createMany({
      data: PERSONA_PERMISSIONS[persona].map((k) => ({ roleId: role.id, permissionId: permissionId.get(k)! })),
    });
    const membership = await prisma.organizationMembership.create({
      data: { organizationId: env.orgId, userId: id, status: 'ACTIVE' },
    });
    await prisma.organizationMembershipRole.create({
      data: { membershipId: membership.id, roleId: role.id, assignedBy: id },
    });
    await prisma.projectMember.create({ data: { projectId: env.projectId, userId: id, joinedBy: id } });
  }

  const as = (persona: Persona): RequestIdentity => ({
    userId: userIds[persona],
    activeOrganizationId: env.orgId,
    tenantSlug: env.identity.tenantSlug,
    roles: PERSONA_ROLES[persona],
    permissions: PERSONA_PERMISSIONS[persona],
  });

  return { ...env, userIds, as };
}

export interface MrLineSpec {
  quantity: number;
  /** Estimated unit price; omit for an unpriced line. */
  estimate?: number;
  description?: string;
  /** Default: the env's leaf BOQ node (a valid project cost target). */
  boqNodeId?: string | null;
}

let mrSeq = 0;

/** An APPROVED material request (approved quantity = requested), written directly. */
export async function createApprovedMr(
  prisma: PrismaClient,
  env: QuotationTestEnv,
  opts: {
    lines?: MrLineSpec[];
    requestedBy?: Persona;
    priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    status?: 'APPROVED' | 'SUBMITTED' | 'DRAFT';
    currencyCode?: string;
  } = {},
) {
  const lines = opts.lines ?? [{ quantity: 10, estimate: 50 }];
  mrSeq += 1;
  return prisma.materialRequest.create({
    data: {
      organizationId: env.orgId,
      mrNumber: `MR-T${Date.now().toString(36)}${mrSeq}`,
      requestScope: 'PROJECT',
      projectId: env.projectId,
      requestedBy: env.userIds[opts.requestedBy ?? 'requester'],
      requestedDate: new Date('2026-10-01'),
      title: 'Cement & rebar',
      currencyCode: opts.currencyCode ?? 'USD',
      priority: opts.priority ?? 'NORMAL',
      status: opts.status ?? 'APPROVED',
      lines: {
        create: lines.map((l, i) => ({
          lineNumber: i + 1,
          lineType: 'MATERIAL' as const,
          materialId: env.materialId,
          description: l.description ?? `Line ${i + 1}`,
          unitOfMeasureId: env.uomId,
          requestedQuantity: new Decimal(l.quantity),
          approvedQuantity: (opts.status ?? 'APPROVED') === 'APPROVED' ? new Decimal(l.quantity) : null,
          estimatedUnitPrice: l.estimate === undefined ? null : new Decimal(l.estimate),
          boqNodeId: l.boqNodeId === undefined ? env.boqNodeId : l.boqNodeId,
          spendCategoryId: env.spendCategoryId,
        })),
      },
    },
    include: { lines: { orderBy: { lineNumber: 'asc' } } },
  });
}

/** A READY, TEMPORARY image file uploaded by `persona` (the presign → PUT → confirm end state). */
export async function createUploadedPhoto(
  prisma: PrismaClient,
  env: QuotationTestEnv,
  persona: Persona,
  opts: { content?: string; mimeType?: string; sizeBytes?: number; checksum?: string | null; status?: 'READY' | 'PENDING' } = {},
) {
  const content = opts.content ?? randomUUID();
  const checksum =
    opts.checksum === undefined ? createHash('sha256').update(content).digest('hex') : opts.checksum;
  return prisma.platformFile.create({
    data: {
      organizationId: env.orgId,
      originalName: 'quote.jpg',
      mimeType: opts.mimeType ?? 'image/jpeg',
      sizeBytes: opts.sizeBytes ?? 200_000,
      checksumSha256: checksum,
      storageBucket: 'test',
      storageKey: `${env.orgId}/${randomUUID()}`,
      status: opts.status ?? 'READY',
      lifecycle: 'TEMPORARY',
      uploadedBy: env.userIds[persona],
    },
  });
}

export async function cleanupQuotationEnv(prisma: PrismaClient, env: QuotationTestEnv): Promise<void> {
  const orgId = env.orgId;
  await prisma.$executeRaw`DELETE FROM notifications WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM quotation_quote_photos WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM quotation_quotes WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM quotation_requests WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM purchase_order_revision_attachments WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM audit_outbox_events WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM audit_logs WHERE org_id = ${orgId}`;
  await cleanupGovernance(prisma, orgId);
  await prisma.$executeRaw`DELETE FROM organization_membership_roles WHERE membership_id IN (SELECT id FROM organization_memberships WHERE organization_id = ${orgId})`;
  await prisma.$executeRaw`DELETE FROM organization_memberships WHERE organization_id = ${orgId}`;
  await prisma.$executeRaw`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE organization_id = ${orgId})`;
  await prisma.$executeRaw`DELETE FROM roles WHERE organization_id = ${orgId}`;
  await ProcurementFixtureFactory.cleanup(prisma, orgId);
  await prisma.$executeRaw`DELETE FROM platform_files WHERE organization_id = ${orgId}`;
}

/**
 * Seeds the ACCO quotation award bands for the test org (inactive, as the seed does) and switches
 * them on or off — the per-org activation step.
 */
export async function setAwardBandsActive(prisma: PrismaClient, env: QuotationTestEnv, isActive: boolean) {
  const { seedQuotationAwardBands } = await import('../../../../../platform/workflows/seeders/acco-workflows.seed.js');
  const log = console.log;
  console.log = () => undefined;
  try {
    await seedQuotationAwardBands(prisma, env.orgId);
  } finally {
    console.log = log;
  }
  const bindings = await prisma.workflowTriggerBinding.findMany({
    where: { organizationId: env.orgId, entityType: 'QuotationRequest' },
    select: { id: true, workflowDefinitionId: true },
  });
  await prisma.workflowTriggerBinding.updateMany({ where: { id: { in: bindings.map((b) => b.id) } }, data: { isActive } });
  await prisma.workflowDefinition.updateMany({
    where: { id: { in: bindings.map((b) => b.workflowDefinitionId) } },
    data: { isActive },
  });
}
