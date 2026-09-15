import { NotificationRecipientService } from './notification-recipient.service.js';

/**
 * ADR-031 — the recipient audience is FINANCE + LEADERSHIP, not "everyone on the project". The generator
 * spec's Prisma double ignores `where`, so the narrowing itself is asserted HERE by capturing the query
 * args passed to `projectMember.findMany` / `organizationMembership.findMany`.
 */

const ORG = 'org_1';
const PROJECT = 'project_1';

function makePrisma(opts: { members?: { userId: string }[]; orgHolders?: { userId: string }[] } = {}) {
  const projectMemberFindMany = jest.fn().mockResolvedValue(opts.members ?? []);
  const organizationMembershipFindMany = jest.fn().mockResolvedValue(opts.orgHolders ?? []);
  const prisma = {
    projectMember: { findMany: projectMemberFindMany },
    organizationMembership: { findMany: organizationMembershipFindMany },
  } as unknown as import('@prisma/client').PrismaClient;
  return { prisma, projectMemberFindMany, organizationMembershipFindMany };
}

describe('NotificationRecipientService.resolveForProject', () => {
  it('filters project members to finance/commercial project roles only (drops site/PM/QS/viewer)', async () => {
    const svc = new NotificationRecipientService();
    const { prisma, projectMemberFindMany } = makePrisma();

    await svc.resolveForProject(prisma, ORG, PROJECT);

    const where = projectMemberFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ projectId: PROJECT, removedAt: null });
    expect(where.roles.some.removedAt).toBeNull();
    expect(where.roles.some.role.in).toEqual(['COMMERCIAL_MANAGER', 'FINANCE_REVIEWER']);
    expect(where.roles.some.role.in).not.toContain('SITE_ENGINEER');
    expect(where.roles.some.role.in).not.toContain('PROJECT_MANAGER');
    expect(where.roles.some.role.in).not.toContain('QUANTITY_SURVEYOR');
    expect(where.roles.some.role.in).not.toContain('VIEWER');
  });

  it('filters org holders to finance + leadership role names on an ACTIVE, non-removed membership', async () => {
    const svc = new NotificationRecipientService();
    const { prisma, organizationMembershipFindMany } = makePrisma();

    await svc.resolveForProject(prisma, ORG, PROJECT);

    const where = organizationMembershipFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ organizationId: ORG, status: 'ACTIVE', removedAt: null });
    expect(where.roles.some.removedAt).toBeNull();
    // ACCO's configured Role.name values under the revised scheme: the finance function is the single
    // `Finance Officer` (merged Finance & Commercial + Accounting), plus finance/exec leadership
    // (CFO, CEO) and platform ADMIN. Matching these exactly keeps finance from silently getting nothing.
    expect(where.roles.some.role.name.in).toEqual(['Finance Officer', 'CFO', 'CEO', 'ADMIN']);
    // The narrowing's whole point: operational / non-finance roles are excluded org-wide too.
    expect(where.roles.some.role.name.in).not.toContain('Construction Director');
    expect(where.roles.some.role.name.in).not.toContain('Project Manager');
    expect(where.roles.some.role.name.in).not.toContain('Site Engineer');
    expect(where.roles.some.role.name.in).not.toContain('Procurement Manager');
  });

  it('returns the deduped union of project members and org holders', async () => {
    const svc = new NotificationRecipientService();
    const { prisma } = makePrisma({
      members: [{ userId: 'u1' }, { userId: 'u3' }],
      orgHolders: [{ userId: 'u2' }, { userId: 'u1' }], // u1 also a project member
    });

    const result = await svc.resolveForProject(prisma, ORG, PROJECT);

    expect(new Set(result)).toEqual(new Set(['u1', 'u2', 'u3']));
    expect(result).toHaveLength(3); // u1 not duplicated
  });

  it('returns an empty list when neither a finance/commercial member nor an org finance holder exists', async () => {
    const svc = new NotificationRecipientService();
    const { prisma } = makePrisma({ members: [], orgHolders: [] });

    await expect(svc.resolveForProject(prisma, ORG, PROJECT)).resolves.toEqual([]);
  });
});
