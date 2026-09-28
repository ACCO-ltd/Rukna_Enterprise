/**
 * ADR-019 amendment 2026-09-28 — live-DB proof of the project activity selection and the
 * readiness evidence queries (ProjectPrismaRepository). Seeds an isolated org and removes it.
 */

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { ProjectPrismaRepository } from '../infrastructure/project-prisma.repository.js';
import { readableActivityFamilies } from '../domain/project-activity.js';
import { PERMISSIONS } from '@erp/types';

describe('ProjectPrismaRepository — activity + readiness evidence (live DB)', () => {
  const prisma = new PrismaClient();
  const repo = new ProjectPrismaRepository();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `pact-org-${suffix}`;
  const userA = `pact-ua-${suffix}`;
  const userB = `pact-ub-${suffix}`;

  let projectId: string;
  let otherProjectId: string;
  let contractId: string;
  let guaranteeLikeId: string; // a contract child: a payment installment

  const t = (minute: number) => new Date(Date.UTC(2026, 8, 1, 10, minute));

  async function audit(data: {
    resource: string;
    resourceId: string;
    action: string;
    sourceCommand?: string | null;
    at: Date;
    id?: string;
  }) {
    return prisma.auditLog.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        userId: userA,
        orgId,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId,
        sourceCommand: data.sourceCommand ?? null,
        createdAt: data.at,
      },
    });
  }

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: orgId, name: `Pact ${suffix}`, slug: `pact-${suffix}`, status: 'ACTIVE' },
    });
    for (const [id, first] of [
      [userA, 'Asha'],
      [userB, 'Omar'],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@example.test`,
          passwordHash: 'x',
          firstName: first,
          lastName: 'Test',
          organizationId: orgId,
        },
      });
    }
    const client = await prisma.client.create({
      data: { organizationId: orgId, code: `CL-${suffix.slice(-6)}`, name: 'Client' },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        code: `PA-${suffix.slice(-6)}`,
        name: 'Activity project',
        currency: 'USD',
        createdBy: userA,
        clientId: client.id,
      },
    });
    projectId = project.id;
    const other = await prisma.project.create({
      data: { organizationId: orgId, code: `PB-${suffix.slice(-6)}`, name: 'Other', currency: 'USD', createdBy: userA },
    });
    otherProjectId = other.id;

    const boq = await prisma.boq.create({ data: { organizationId: orgId, projectId, currency: 'USD' } });
    await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 1, status: 'SUPERSEDED' as never, createdBy: userA, baselinedAt: t(1) },
    });
    const committed = await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 2, status: 'COMMITTED' as never, createdBy: userA, baselinedAt: t(5) },
    });
    const contract = await prisma.contract.create({
      data: {
        organizationId: orgId,
        projectId,
        clientId: client.id,
        boqVersionId: committed.id,
        contractNumber: `CT-${suffix.slice(-6)}`,
        contractValue: new Decimal(1000),
        baseContractValue: new Decimal(1000),
        currency: 'USD',
        status: 'ACTIVE',
        contractKind: 'CLIENT_CONTRACT',
        startDate: new Date('2026-09-01'),
        createdBy: userA,
      },
    });
    contractId = contract.id;
    const installment = await prisma.contractPaymentInstallment.create({
      data: {
        contractId,
        name: 'Advance',
        sortOrder: 1,
        percentage: new Decimal('0.4'),
        triggerType: 'MILESTONE' as never,
        milestoneLabel: 'Advance',
      },
    });
    guaranteeLikeId = installment.id;

    await prisma.projectMember.create({
      data: { projectId, userId: userA, joinedBy: userA, joinedAt: t(0) },
    });
    await prisma.projectMember.create({
      data: { projectId, userId: userB, joinedBy: userA, joinedAt: t(2), removedAt: t(3), removedBy: userA },
    });

    // The history, oldest to newest.
    await audit({ resource: 'Project', resourceId: projectId, action: 'CREATE', sourceCommand: 'project.create', at: t(0) });
    await audit({ resource: '/api/v1/projects', resourceId: 'collection', action: 'POST', at: t(0) }); // not tied
    await audit({ resource: '/api/v1/projects/:id', resourceId: projectId, action: 'PATCH', at: t(1) });
    await audit({ resource: '/api/v1/projects/:id/members', resourceId: projectId, action: 'POST', at: t(2) });
    await audit({ resource: '/api/v1/projects/:projectId/boq/versions/:versionId/commit', resourceId: projectId, action: 'POST', at: t(5) });
    await audit({ resource: '/api/v1/projects/:projectId/boq/versions/:versionId/nodes/:nodeId', resourceId: projectId, action: 'PATCH', at: t(5) }); // line edit: left out
    await audit({ resource: 'Contract', resourceId: contractId, action: 'CREATE', sourceCommand: 'contract.record-signed', at: t(6) });
    await audit({ resource: 'ContractPaymentInstallment', resourceId: guaranteeLikeId, action: 'UPDATE', sourceCommand: 'commercial.markReadyToBill', at: t(7) });
    await audit({ resource: 'Project', resourceId: projectId, action: 'CREATE', sourceCommand: 'commercial.recordProjectPayment', at: t(8) });
    // Same instant, two rows: the keyset cursor must split them by id.
    await audit({ id: `pact-z-${suffix}`, resource: 'Project', resourceId: projectId, action: 'SUSPEND', sourceCommand: 'project.suspend', at: t(9) });
    await audit({ id: `pact-y-${suffix}`, resource: '/api/v1/projects/:id/members/:userId', resourceId: projectId, action: 'DELETE', at: t(9) });
    // A lifecycle command's interceptor twin — the outbox row above already tells it.
    await audit({ resource: '/api/v1/projects/:id/suspend', resourceId: projectId, action: 'POST', at: t(9) });
    // Another project's event and an unrelated variation.
    await audit({ resource: 'Project', resourceId: otherProjectId, action: 'CREATE', sourceCommand: 'project.create', at: t(10) });
    await audit({ resource: 'VariationOrder', resourceId: `vo-elsewhere-${suffix}`, action: 'CREATE', sourceCommand: 'variation.create', at: t(10) });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { orgId } });
    await prisma.projectMember.deleteMany({ where: { project: { organizationId: orgId } } });
    await prisma.contractPaymentInstallment.deleteMany({ where: { contract: { organizationId: orgId } } });
    await prisma.contract.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.client.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  const all = () =>
    readableActivityFamilies([PERMISSIONS.projectsView, PERMISSIONS.contractsView, PERMISSIONS.boqView]);

  it('selects the project and its owned records, newest first, and nothing else', async () => {
    const rows = await repo.findProjectActivity(prisma, orgId, projectId, all(), { cursor: null, take: 50 });
    expect(rows.map((r) => r.sourceCommand ?? `${r.action} ${r.resource}`)).toEqual([
      'project.suspend', // t9, id pact-z > pact-y
      'DELETE /api/v1/projects/:id/members/:userId',
      'commercial.recordProjectPayment',
      'commercial.markReadyToBill',
      'contract.record-signed',
      'POST /api/v1/projects/:projectId/boq/versions/:versionId/commit',
      'POST /api/v1/projects/:id/members',
      'PATCH /api/v1/projects/:id',
      'project.create',
    ]);
    expect(rows[0]!.user).toMatchObject({ firstName: 'Asha' });
  });

  it('a member without view:contract / view:boq sees neither contract, commercial nor BOQ events', async () => {
    const rows = await repo.findProjectActivity(
      prisma,
      orgId,
      projectId,
      readableActivityFamilies([PERMISSIONS.projectsView]),
      { cursor: null, take: 50 },
    );
    const described = rows.map((r) => r.sourceCommand ?? r.resource);
    expect(described).not.toContain('contract.record-signed');
    expect(described).not.toContain('commercial.markReadyToBill');
    expect(described).not.toContain('commercial.recordProjectPayment');
    expect(described).not.toContain('/api/v1/projects/:projectId/boq/versions/:versionId/commit');
    expect(described).toContain('project.create');
    expect(described).toContain('/api/v1/projects/:id/members');
  });

  it('pages with a keyset cursor, splitting rows that share a timestamp', async () => {
    const first = await repo.findProjectActivity(prisma, orgId, projectId, all(), { cursor: null, take: 1 });
    expect(first[0]!.sourceCommand).toBe('project.suspend');
    const second = await repo.findProjectActivity(prisma, orgId, projectId, all(), {
      cursor: { createdAt: first[0]!.createdAt, id: first[0]!.id },
      take: 2,
    });
    expect(second.map((r) => r.resource)).toEqual(['/api/v1/projects/:id/members/:userId', 'Project']);
    expect(second[1]!.sourceCommand).toBe('commercial.recordProjectPayment');
  });

  it('loads the readiness evidence: signature events, commit stamps, every membership row', async () => {
    const signatures = await repo.findContractSignatureEvents(prisma, orgId, contractId);
    expect(signatures).toEqual([{ sourceCommand: 'contract.record-signed', createdAt: t(6) }]);

    const snapshot = await repo.findReadinessSnapshot(prisma, orgId, projectId);
    expect(snapshot!.contracts[0]).toMatchObject({ id: contractId, status: 'ACTIVE' });
    expect(snapshot!.boq!.versions.map((v) => [v.status, v.baselinedAt?.toISOString()]).sort()).toEqual([
      ['COMMITTED', t(5).toISOString()],
      ['SUPERSEDED', t(1).toISOString()],
    ]);
    expect(snapshot!.members).toHaveLength(2);
    expect(snapshot!.members.filter((m) => m.removedAt === null)).toHaveLength(1);
  });
});
