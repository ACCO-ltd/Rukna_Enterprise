/**
 * Step 8 — the audit trail is read a page at a time, searched and filtered on the server, and
 * names the person who acted.
 *
 *   AUD-01  newest first, paged, with the person named and the filter facets
 *   AUD-02  search matches the person and the reason; resource, person and date filters narrow
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../../business/accounting/__tests__/helpers/fixture.factory';
import { AuditLogsService } from '../application/audit-logs.service';
import { AuditLogsPrismaRepository } from '../infrastructure/audit-logs-prisma.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let audit: AuditLogsService;
let userName: string;
let userId: string;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  audit = new AuditLogsService(new AuditLogsPrismaRepository({ getClient: () => prisma } as never));
  const user = await prisma.user.create({
    data: {
      email: `auditor-${env.orgId}@example.com`,
      passwordHash: 'x',
      firstName: 'Faadumo',
      lastName: 'Warsame',
      organizationId: env.orgId,
    },
  });
  userId = user.id;
  userName = 'Faadumo Warsame';
  const rows = [
    { action: 'CREATE', resource: 'client-invoice', resourceId: 'inv-1', createdAt: new Date('2026-03-01T09:00:00Z') },
    { action: 'APPROVE', resource: 'client-invoice', resourceId: 'inv-1', createdAt: new Date('2026-03-02T09:00:00Z') },
    { action: 'REJECT', resource: 'supplier-bill', resourceId: 'bill-9', reason: 'Wrong supplier', createdAt: new Date('2026-03-03T23:30:00Z') },
  ];
  for (const row of rows) {
    await prisma.auditLog.create({ data: { ...row, userId, orgId: env.orgId } });
  }
}, 90_000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { orgId: env.orgId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('AUD-01: newest first, paged, with the person named and the facets', async () => {
  const first = await audit.findPage(env.orgId, { pageSize: 2 });
  expect(first.total).toBe(3);
  expect(first.items.map((i) => i.action)).toEqual(['REJECT', 'APPROVE']);
  expect(first.items[0]!.user).toEqual({ id: userId, name: userName, email: `auditor-${env.orgId}@example.com` });
  expect(first.items[0]!.reason).toBe('Wrong supplier');
  expect(first.facets.resources).toEqual(['client-invoice', 'supplier-bill']);
  expect(first.facets.users).toEqual([{ id: userId, name: userName }]);

  const second = await audit.findPage(env.orgId, { pageSize: 2, page: 2 });
  expect(second.items.map((i) => i.action)).toEqual(['CREATE']);
});

it('AUD-02: search and filters narrow on the server', async () => {
  expect((await audit.findPage(env.orgId, { search: 'wrong supp' })).items.map((i) => i.resourceId)).toEqual(['bill-9']);
  expect((await audit.findPage(env.orgId, { search: 'faadumo' })).total).toBe(3);
  expect((await audit.findPage(env.orgId, { resource: 'client-invoice' })).total).toBe(2);
  expect((await audit.findPage(env.orgId, { userId: 'someone-else' })).total).toBe(0);
  // Dates are inclusive: the 23:30 entry on 3 March is in a "to 3 March" range.
  expect((await audit.findPage(env.orgId, { from: '2026-03-02', to: '2026-03-03' })).items.map((i) => i.action)).toEqual([
    'REJECT',
    'APPROVE',
  ]);
});
