import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { grantJournalSelfPostPermissions } from '../../../../../prisma/seeds/journal-self-post-permissions.js';

/**
 * ADR-022 amendment (2026-10-27) — post-own:journal for the Finance Officer and CFO (live DB).
 *
 *  - JSP-01: grants post-own:journal to both roles and manage:journal to the CFO, nothing else.
 *  - JSP-02: idempotent — a second run grants nothing new.
 *  - JSP-03: an org without the roles is reported, nothing is written.
 */
describe('Journal self-post grant', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `jsp-org-${suffix}`;
  const emptyOrgId = `jsp-empty-${suffix}`;
  const roleIds: string[] = [];

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
        { id: orgId, name: `Org ${suffix}`, slug: `jsp-${suffix}`, status: 'ACTIVE' },
        { id: emptyOrgId, name: `Empty ${suffix}`, slug: `jsp-e-${suffix}`, status: 'ACTIVE' },
      ],
    });
    for (const name of ['Finance Officer', 'CFO', 'Project Manager']) {
      const role = await prisma.role.create({ data: { organizationId: orgId, name, description: name } });
      roleIds.push(role.id);
    }
  });

  afterAll(async () => {
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
    await prisma.role.deleteMany({ where: { organizationId: { in: [orgId, emptyOrgId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, emptyOrgId] } } });
    await prisma.$disconnect();
  });

  it('JSP-01/02: grants the self-post permissions once, to the Finance Officer and CFO only', async () => {
    const [financeId, cfoId, pmId] = roleIds;

    const first = await grantJournalSelfPostPermissions(prisma, orgId);
    expect(first.map((r) => r.status)).toEqual(['granted', 'granted', 'granted']);
    expect(await grantsOf(financeId)).toEqual(['post-own:journal']);
    expect(await grantsOf(cfoId)).toEqual(['manage:journal', 'post-own:journal']);
    expect(await grantsOf(pmId)).toEqual([]);

    const second = await grantJournalSelfPostPermissions(prisma, orgId);
    expect(second.map((r) => r.status)).toEqual(['already-granted', 'already-granted', 'already-granted']);
  });

  it('JSP-03: reports missing roles and writes nothing', async () => {
    const results = await grantJournalSelfPostPermissions(prisma, emptyOrgId);
    expect(results.every((r) => r.status === 'role-missing')).toBe(true);
  });
});
