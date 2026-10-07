import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { buildQuotationServices, type QuotationServices } from './helpers/build-quotation-services.js';
import {
  cleanupQuotationEnv,
  createApprovedMr,
  createQuotationEnv,
  type QuotationTestEnv,
} from './helpers/quotation-fixture.js';
import { refusal, steps } from './helpers/quotation-steps.js';

/**
 * Review M2/M3 — a project's quotation is reached only by that project's members (or the
 * project-access bypass roles): its photo files (as quote photos and as PO evidence), and the
 * QUOTES_READY notification.
 */
describe('quotation project access (review M2, M3)', () => {
  const prisma = new PrismaClient();
  let env: QuotationTestEnv;
  let svc: QuotationServices;
  let s: ReturnType<typeof steps>;
  let outsiderId: string;
  let bypassId: string;

  const outsider = (): RequestIdentity => ({
    userId: outsiderId,
    activeOrganizationId: env.orgId,
    tenantSlug: env.identity.tenantSlug,
    roles: ['finance-outsider'],
    permissions: [PERMISSIONS.procurementView, PERMISSIONS.commitmentsView, PERMISSIONS.quotationsAward],
  });

  beforeAll(async () => {
    env = await createQuotationEnv(prisma);
    svc = buildQuotationServices(prisma);
    s = steps(prisma, env, svc);
    const award = await prisma.permission.findUniqueOrThrow({
      where: { action_resource: { action: 'award', resource: 'quotation' } },
    });
    // Two award holders who are NOT members of the project: one plain, one holding a bypass role.
    for (const [key, roleName] of [
      ['outsider', `outsider-role-${env.orgId}`],
      ['bypass', 'CFO'],
    ] as const) {
      const id = `${env.orgId}-${key}`;
      await prisma.user.create({
        data: { id, organizationId: env.orgId, email: `${id}@example.test`, passwordHash: 'x', firstName: key, lastName: 'T', status: 'ACTIVE' },
      });
      const role = await prisma.role.create({ data: { organizationId: env.orgId, name: roleName } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: award.id } });
      const membership = await prisma.organizationMembership.create({
        data: { organizationId: env.orgId, userId: id, status: 'ACTIVE' },
      });
      await prisma.organizationMembershipRole.create({ data: { membershipId: membership.id, roleId: role.id, assignedBy: id } });
      if (key === 'outsider') outsiderId = id;
      else bypassId = id;
    }
  });

  afterAll(async () => {
    await cleanupQuotationEnv(prisma, env);
    await prisma.$disconnect();
  });

  it('M2: a non-member with cost visibility cannot download the photo, nor its PO evidence copy', async () => {
    const mr = await createApprovedMr(prisma, env, { lines: [{ quantity: 1, estimate: 90 }] });
    const request = await s.collected(mr.id, ['Hodan']);
    const fileId = request.quotes[0].photos[0].fileId;
    expect((await refusal(svc.fileAuth.assertCanRead(outsider(), fileId))).status).toBe(403);
    const bypass = { ...outsider(), userId: bypassId, roles: ['CFO'] };
    await expect(svc.fileAuth.assertCanRead(bypass, fileId)).resolves.toBeTruthy();

    // Once attached to the PO as evidence, project access still applies.
    await svc.collect.send(env.as('collector'), request.id);
    await svc.selection.enterTotal(env.as('selector'), request.id, request.quotes[0].id, '90');
    await svc.awards.award(env.as('selector'), request.id, {
      quoteId: request.quotes[0].id,
      paymentPath: 'BUYER_CASH',
      awardSupplierId: env.supplierId,
    });
    await svc.orders.raiseOrder(env.as('collector'), request.id, {});
    expect((await refusal(svc.fileAuth.assertCanRead(outsider(), fileId))).status).toBe(403);
    await expect(svc.fileAuth.assertCanRead(env.as('director'), fileId)).resolves.toBeTruthy();
  });

  it('M3: QUOTES_READY goes to award holders who can reach the project (members or bypass roles) only', async () => {
    const mr = await createApprovedMr(prisma, env);
    const request = await s.collected(mr.id);
    await svc.collect.send(env.as('collector'), request.id);
    const recipients = (
      await prisma.notification.findMany({
        where: { resourceId: request.id, kind: 'QUOTES_READY' },
        select: { recipientUserId: true },
      })
    ).map((n) => n.recipientUserId);
    expect(recipients).toContain(bypassId);
    expect(recipients).toContain(env.userIds.selector);
    expect(recipients).not.toContain(outsiderId);
  });
});
