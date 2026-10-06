import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import {
  grantMaterialRequestApprovalToFinance,
  MR_APPROVER_ROLE_NAME,
} from '../../../../../prisma/seeds/finance-mr-approval.js';

/**
 * Owner decision 2026-10-06 — the finance team approves material requests (live DB).
 *
 *  - GRANT-01: links `approve:material-request` to the org's Finance Officer, and only to it.
 *  - GRANT-02: idempotent — a second run grants nothing new.
 *  - GRANT-03: leaves the role's other grants alone, including one an admin removed in-app.
 *  - GRANT-04: an org without the role is reported, nothing is written.
 */
describe('Finance material-request approval grant', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `fmr-org-${suffix}`;
  const otherOrgId = `fmr-other-${suffix}`;
  let financeRoleId: string;
  let otherRoleId: string;

  const grantsOf = async (roleId: string) =>
    (
      await prisma.rolePermission.findMany({
        where: { roleId },
        select: { permission: { select: { action: true, resource: true } } },
      })
    )
      .map((g) => `${g.permission.action}:${g.permission.resource}`)
      .sort();

  beforeAll(async () => {
    await prisma.organization.createMany({
      data: [
        { id: orgId, name: `Org ${suffix}`, slug: `fmr-${suffix}`, status: 'ACTIVE' },
        { id: otherOrgId, name: `Other ${suffix}`, slug: `fmr-o-${suffix}`, status: 'ACTIVE' },
      ],
    });
    const viewAccounting = await prisma.permission.upsert({
      where: { action_resource: { action: 'view', resource: 'accounting' } },
      create: { action: 'view', resource: 'accounting', description: 'View accounting' },
      update: {},
    });
    const finance = await prisma.role.create({
      data: { organizationId: orgId, name: MR_APPROVER_ROLE_NAME, description: 'Finance' },
    });
    const other = await prisma.role.create({
      data: { organizationId: orgId, name: 'Project Manager', description: 'PM' },
    });
    financeRoleId = finance.id;
    otherRoleId = other.id;
    await prisma.rolePermission.create({
      data: { roleId: finance.id, permissionId: viewAccounting.id },
    });
  });

  afterAll(async () => {
    await prisma.rolePermission.deleteMany({
      where: { roleId: { in: [financeRoleId, otherRoleId] } },
    });
    await prisma.role.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await prisma.$disconnect();
  });

  it('GRANT-01..03: grants exactly approve:material-request to the Finance Officer, once', async () => {
    const first = await grantMaterialRequestApprovalToFinance(prisma, orgId);
    expect(first).toEqual({ status: 'granted', roleId: financeRoleId });
    expect(await grantsOf(financeRoleId)).toEqual(['approve:material-request', 'view:accounting']);
    expect(await grantsOf(otherRoleId)).toEqual([]);

    const second = await grantMaterialRequestApprovalToFinance(prisma, orgId);
    expect(second).toEqual({ status: 'already-granted', roleId: financeRoleId });
    expect(await grantsOf(financeRoleId)).toEqual(['approve:material-request', 'view:accounting']);
  });

  it('GRANT-04: reports a missing role and writes nothing', async () => {
    expect(await grantMaterialRequestApprovalToFinance(prisma, otherOrgId)).toEqual({
      status: 'role-missing',
    });
    expect(
      await prisma.rolePermission.count({ where: { role: { organizationId: otherOrgId } } }),
    ).toBe(0);
  });
});
