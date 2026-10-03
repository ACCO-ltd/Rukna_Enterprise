import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { CommercialPrismaRepository } from '../infrastructure/commercial-prisma.repository.js';
import { CommercialBillingService } from '../application/commercial-billing.service.js';
import { linkVerifiedMilestones } from './verified-milestones.fixture.js';
import {
  grantMarkReadyToConstructionDirector,
  MARK_READY_ROLE_NAME,
} from '../../../../../prisma/seeds/construction-mark-ready.js';

/**
 * ADR-043 decision 1 — Construction marks a verified stage ready to bill (live DB, real audit outbox).
 *
 *  - MR-01..04: mark → undo → mark again writes one audit event per act (the old constant
 *    idempotency key collided on the outbox's unique index the second time and rolled the mark
 *    back — invisible while no UI could undo).
 *  - MR-05..07: undo is refused once a draft invoice exists; a cancelled invoice does not block.
 *  - MR-08: a stage on another project is not found through this project's route.
 *  - SEED-01..03: the targeted grant links only `mark-ready:billing` to the Construction Director,
 *    is idempotent, and leaves every other grant (including an in-app removal) alone.
 */
describe('Construction mark-ready (ADR-043 decision 1)', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `cmr-org-${suffix}`;

  let service: CommercialBillingService;
  let identity: RequestIdentity;
  let projectId: string;
  let otherProjectId: string;
  let contractId: string;
  let clientId: string;
  let stageVerified: string;
  let stageInvoiced: string;
  let stageUnverified: string;

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: orgId, name: `Org ${suffix}`, slug: `cmr-${suffix}`, status: 'ACTIVE' },
    });
    const user = await prisma.user.create({
      data: { email: `cmr-${suffix}@cmr.test`, passwordHash: 'x', firstName: 'C', lastName: 'D', organizationId: orgId },
    });
    identity = {
      userId: user.id,
      activeOrganizationId: orgId,
      tenantSlug: `cmr-${suffix}`,
      roles: [MARK_READY_ROLE_NAME],
      permissions: [PERMISSIONS.contractsView, PERMISSIONS.billingMarkReady],
    } as RequestIdentity;

    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const projectAccess = { assertContract: async () => undefined, assertMember: async () => undefined } as unknown as ProjectAccessService;
    service = new CommercialBillingService(
      tenancy,
      projectAccess,
      new CommercialPrismaRepository(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new TransactionalAuditOutboxService(),
    );

    const project = await prisma.project.create({
      data: { organizationId: orgId, code: `CMR-${suffix.slice(-6)}`, name: 'Mark-ready project', currency: 'USD', createdBy: user.id },
    });
    projectId = project.id;
    otherProjectId = (
      await prisma.project.create({
        data: { organizationId: orgId, code: `CMR2-${suffix.slice(-5)}`, name: 'Other project', currency: 'USD', createdBy: user.id },
      })
    ).id;
    clientId = (await prisma.client.create({ data: { organizationId: orgId, code: `CL-${suffix.slice(-6)}`, name: 'Client' } })).id;
    const boq = await prisma.boq.create({ data: { organizationId: orgId, projectId, currency: 'USD' } });
    const version = await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 1, status: 'BASELINED', createdBy: user.id },
    });
    contractId = (
      await prisma.contract.create({
        data: {
          organizationId: orgId,
          projectId,
          clientId,
          boqVersionId: version.id,
          contractNumber: `CT-CMR-${suffix.slice(-6)}`,
          contractValue: new Decimal('100000'),
          baseContractValue: new Decimal('100000'),
          currency: 'USD',
          status: 'ACTIVE',
          billingModel: 'MILESTONE',
          createdBy: user.id,
        },
      })
    ).id;
    const stage = (name: string, sortOrder: number) =>
      prisma.contractPaymentInstallment.create({
        data: { contractId, name, sortOrder, percentage: new Decimal('0.3000'), triggerType: 'MILESTONE', milestoneLabel: name },
      });
    stageVerified = (await stage('Structure', 0)).id;
    stageInvoiced = (await stage('Finishes', 1)).id;
    await linkVerifiedMilestones(prisma, contractId);
    // Created after the fixture links: a stage whose milestone is still PLANNED.
    const planned = await prisma.programmeMilestone.create({
      data: { organizationId: orgId, projectId, code: `PL-${suffix.slice(-6)}`, name: 'Handover', status: 'PLANNED', createdBy: user.id, baselineDate: new Date('2027-01-01') },
    });
    stageUnverified = (
      await prisma.contractPaymentInstallment.create({
        data: { contractId, name: 'Handover', sortOrder: 2, percentage: new Decimal('0.4000'), triggerType: 'MILESTONE', milestoneLabel: 'Handover', programmeMilestoneId: planned.id },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM audit_outbox_events WHERE organization_id = ${orgId}`;
    await prisma.auditLog.deleteMany({ where: { orgId } });
    await prisma.clientInvoice.deleteMany({ where: { organizationId: orgId } });
    await prisma.contractPaymentInstallment.deleteMany({ where: { contract: { organizationId: orgId } } });
    await prisma.contract.deleteMany({ where: { organizationId: orgId } });
    await prisma.client.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.rolePermission.deleteMany({ where: { role: { organizationId: orgId } } });
    await prisma.role.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${orgId}`;
    await prisma.$disconnect();
  });

  const readinessEvents = () =>
    prisma.auditOutboxEvent.findMany({
      where: { organizationId: orgId, aggregateId: stageVerified },
      orderBy: { occurredAt: 'asc' },
      select: { eventType: true },
    });

  it('MR-01: marks a verified stage ready and records who did it, with one audit event', async () => {
    const result = await service.markReadyToBill(identity, stageVerified, undefined, projectId);
    expect(result.readyToBill).toBe(true);
    const row = await prisma.contractPaymentInstallment.findUniqueOrThrow({ where: { id: stageVerified } });
    expect(row.readyToBillBy).toBe(identity.userId);
    expect((await readinessEvents()).map((e) => e.eventType)).toEqual(['MILESTONE_READY_TO_BILL']);
  });

  it('MR-02: marking again is a no-op — no second audit event', async () => {
    await service.markReadyToBill(identity, stageVerified, undefined, projectId);
    expect(await readinessEvents()).toHaveLength(1);
  });

  it('MR-03: undo ready clears it and records the revoke', async () => {
    const result = await service.revokeReadyToBill(identity, stageVerified, undefined, projectId);
    expect(result.readyToBill).toBe(false);
    expect((await readinessEvents()).map((e) => e.eventType)).toEqual(['MILESTONE_READY_TO_BILL', 'MILESTONE_READINESS_REVOKED']);
  });

  it('MR-04: mark ready again after an undo succeeds (no audit idempotency-key collision)', async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const result = await service.markReadyToBill(identity, stageVerified, undefined, projectId);
    expect(result.readyToBill).toBe(true);
    expect((await readinessEvents()).map((e) => e.eventType)).toEqual([
      'MILESTONE_READY_TO_BILL',
      'MILESTONE_READINESS_REVOKED',
      'MILESTONE_READY_TO_BILL',
    ]);
  });

  it('MR-05: a stage whose milestone is not verified is refused, in words', async () => {
    await expect(service.markReadyToBill(identity, stageUnverified, undefined, projectId)).rejects.toThrow(/not yet verified/);
  });

  const draftInvoice = async (documentStatus: 'DRAFT' | 'CANCELLED') =>
    prisma.clientInvoice.create({
      data: {
        organizationId: orgId,
        clientId,
        invoiceDate: new Date('2026-10-01'),
        currencyCode: 'USD',
        subtotal: new Decimal('30000'),
        vatAmount: new Decimal('0'),
        totalAmount: new Decimal('30000'),
        outstandingAmount: new Decimal('30000'),
        billingAddressSnapshot: {},
        createdBy: identity.userId,
        sourceInstallmentId: stageInvoiced,
        documentStatus,
      },
    });

  it('MR-06: undo is refused once Finance has prepared a draft invoice; marking is refused too', async () => {
    await service.markReadyToBill(identity, stageInvoiced, undefined, projectId);
    const invoice = await draftInvoice('DRAFT');
    await expect(service.revokeReadyToBill(identity, stageInvoiced, undefined, projectId)).rejects.toThrow(/cannot be revoked after billing/);
    await prisma.clientInvoice.delete({ where: { id: invoice.id } });
  });

  it('MR-07: a cancelled invoice does not block undo (the stage goes back to Not ready)', async () => {
    await draftInvoice('CANCELLED');
    const result = await service.revokeReadyToBill(identity, stageInvoiced, undefined, projectId);
    expect(result.readyToBill).toBe(false);
    // …and it can be marked ready again for re-billing.
    await expect(service.markReadyToBill(identity, stageInvoiced, undefined, projectId)).resolves.toMatchObject({ readyToBill: true });
  });

  it('MR-09: two concurrent marks write once — one audit event (row lock + conditional update)', async () => {
    const raced = (
      await prisma.contractPaymentInstallment.create({
        data: { contractId, name: 'Race', sortOrder: 9, percentage: new Decimal('0.0000'), triggerType: 'ADVANCE', milestoneLabel: 'Race' },
      })
    ).id;
    const [a, b] = await Promise.all([
      service.markReadyToBill(identity, raced, undefined, projectId),
      service.markReadyToBill(identity, raced, undefined, projectId),
    ]);
    expect(a.readyToBillAt).toBe(b.readyToBillAt);
    const events = await prisma.auditOutboxEvent.count({
      where: { organizationId: orgId, aggregateId: raced, eventType: 'MILESTONE_READY_TO_BILL' },
    });
    expect(events).toBe(1);
  });

  it('MR-10: undo racing Finance’s prepare waits for it, then is refused (409) — readiness stays', async () => {
    const raced = (
      await prisma.contractPaymentInstallment.create({
        data: { contractId, name: 'Race 2', sortOrder: 10, percentage: new Decimal('0.0000'), triggerType: 'ADVANCE', milestoneLabel: 'Race 2' },
      })
    ).id;
    await service.markReadyToBill(identity, raced, undefined, projectId);

    // Stand-in for prepare: take the stage's row lock, create the draft, hold until released.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    const prepare = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM contract_payment_installments WHERE id = ${raced} FOR UPDATE`;
        await tx.clientInvoice.create({
          data: {
            organizationId: orgId, clientId, invoiceDate: new Date('2026-10-01'), currencyCode: 'USD',
            subtotal: new Decimal('0'), vatAmount: new Decimal('0'), totalAmount: new Decimal('0'), outstandingAmount: new Decimal('0'),
            billingAddressSnapshot: {}, createdBy: identity.userId, sourceInstallmentId: raced, documentStatus: 'DRAFT',
          },
        });
        locked();
        await gate;
      },
      { timeout: 20000 },
    );
    await holding;
    // The undo's pre-check sees no invoice yet (uncommitted); it must block on the lock, then refuse.
    const undo = service.revokeReadyToBill(identity, raced, undefined, projectId);
    const outcome = undo.then(
      () => 'revoked',
      (error: { status?: number; getStatus?: () => number }) => error.getStatus?.() ?? error.status,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await prepare;
    expect(await outcome).toBe(409);
    const row = await prisma.contractPaymentInstallment.findUniqueOrThrow({ where: { id: raced } });
    expect(row.readyToBillAt).not.toBeNull();
  });

  it('MR-08: a stage is not found through another project’s route', async () => {
    await expect(service.markReadyToBill(identity, stageVerified, undefined, otherProjectId)).rejects.toThrow(/not found/);
    await expect(service.revokeReadyToBill(identity, stageVerified, undefined, otherProjectId)).rejects.toThrow(/not found/);
  });

  // ─── Targeted production grant ─────────────────────────────────────────────

  describe('grant-construction-mark-ready seed', () => {
    let cdRoleId: string;
    let pmRoleId: string;
    let kept: string; // a permission the admin left on the CD role
    let removed: { action: string; resource: string }; // one the admin took off in-app

    beforeAll(async () => {
      cdRoleId = (await prisma.role.create({ data: { name: MARK_READY_ROLE_NAME, organizationId: orgId, kind: 'CUSTOM' } })).id;
      pmRoleId = (await prisma.role.create({ data: { name: 'Project Manager', organizationId: orgId, kind: 'CUSTOM' } })).id;
      const perm = (action: string, resource: string) =>
        prisma.permission.upsert({ where: { action_resource: { action, resource } }, create: { action, resource }, update: {}, select: { id: true } });
      kept = (await perm('view', 'contract')).id;
      removed = { action: 'approve', resource: 'contract' };
      await perm(removed.action, removed.resource);
      await prisma.rolePermission.create({ data: { roleId: cdRoleId, permissionId: kept } });
      await prisma.rolePermission.create({ data: { roleId: pmRoleId, permissionId: kept } });
    });

    const grantsOf = async (roleId: string) =>
      (await prisma.rolePermission.findMany({ where: { roleId }, select: { permission: { select: { action: true, resource: true } } } }))
        .map((rp) => `${rp.permission.action}:${rp.permission.resource}`)
        .sort();

    it('SEED-01: links mark-ready:billing to the Construction Director only', async () => {
      await expect(grantMarkReadyToConstructionDirector(prisma, orgId)).resolves.toMatchObject({ status: 'granted' });
      expect(await grantsOf(cdRoleId)).toEqual(['mark-ready:billing', 'view:contract']);
      expect(await grantsOf(pmRoleId)).toEqual(['view:contract']);
    });

    it('SEED-02: is idempotent and does not re-add a grant an admin removed in-app', async () => {
      await expect(grantMarkReadyToConstructionDirector(prisma, orgId)).resolves.toMatchObject({ status: 'already-granted' });
      expect(await grantsOf(cdRoleId)).toEqual(['mark-ready:billing', 'view:contract']);
      expect(await grantsOf(cdRoleId)).not.toContain(`${removed.action}:${removed.resource}`);
    });

    it('SEED-03: an org without the role is reported, not created', async () => {
      await expect(grantMarkReadyToConstructionDirector(prisma, `${orgId}-none`)).resolves.toEqual({ status: 'role-missing' });
    });
  });
});
