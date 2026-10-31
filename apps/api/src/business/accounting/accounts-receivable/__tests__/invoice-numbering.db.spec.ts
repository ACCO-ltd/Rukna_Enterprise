/**
 * CI-8 — invoice numbering setting, against the real database:
 *
 *   NM-01  out of the box: one running count, INV-000001 on the first issue
 *   NM-02  carry on from the old system: the next number is set; going back below an issued one is refused
 *   NM-03  yearly: the invoice date's year is in the number and the count restarts per year
 *   NM-04  monthly and daily restart per month / per day, each gapless
 *   NM-05  a bad format lists every problem and changes nothing
 */

import { PrismaClient } from '@prisma/client';
import type { TenancyService } from '../../../../platform/tenancy/tenancy.service';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { InvoiceNumberingService } from '../../accounting-core/application/invoice-numbering.service';
import { DocumentSequenceRepository } from '../../accounting-core/infrastructure/document-sequence.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let numbering: InvoiceNumberingService;
let clientId: string;

const today = new Date('2025-01-20');

async function issue(invoiceDate: string): Promise<string> {
  const draft = await svc.clientInvoiceService.createManual(env.identity, {
    clientId,
    invoiceDate,
    dueDate: '2025-01-31',
    currencyCode: 'USD',
    lines: [{ description: 'Pump hire', quantity: '1', unitPrice: '10.00', revenueAccountCode: '42100' }],
  });
  const issued = await svc.clientInvoiceService.issue(env.identity, draft.id);
  return issued.invoiceNumber!;
}

async function account(code: string, name: string, accountClass: 'INCOME' | 'LIABILITY', subtype: string) {
  const a = await prisma.account.create({
    data: { id: `${env.orgId}-${code}`, organizationId: env.orgId, code, normalBalance: 'CREDIT', createdBy: env.identity.userId },
  });
  await prisma.accountVersion.create({
    data: {
      accountId: a.id,
      versionNumber: 1,
      name,
      accountClass,
      accountSubtype: subtype as never,
      isPostingAllowed: true,
      isControlAccount: false,
      controlPostingPolicy: 'UNRESTRICTED',
      effectiveFrom: new Date('2020-01-01'),
      changedBy: env.identity.userId,
    },
  });
}

const save = (body: Parameters<InvoiceNumberingService['update']>[1]) => numbering.update(env.identity, body, today);
const problems = (p: Promise<unknown>) =>
  p.then(
    () => [],
    (e: { getResponse: () => { details: { problems: string[] } } }) => e.getResponse().details.problems,
  );

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  numbering = new InvoiceNumberingService({ getClient: () => prisma } as unknown as TenancyService, new DocumentSequenceRepository());
  clientId = (await prisma.contract.findFirstOrThrow({ where: { organizationId: env.orgId } })).clientId;
  await account('42100', 'Equipment hire income', 'INCOME', 'OTHER_INCOME');
}, 60_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('NM-01: out of the box, one running count from INV-000001', async () => {
  expect(await numbering.get(env.identity, today)).toMatchObject({ prefix: 'INV-', resetPolicy: 'NEVER', nextNumber: 1, nextInvoiceNumber: 'INV-000001' });
  expect(await issue('2025-01-10')).toBe('INV-000001');
  expect((await numbering.get(env.identity, today)).nextInvoiceNumber).toBe('INV-000002');
});

it('NM-02: carries on from the old system, and never goes back below an issued number', async () => {
  const set = await save({ prefix: 'INV-', resetPolicy: 'NEVER', paddingLength: 6, nextNumber: 3151 });
  expect(set.nextInvoiceNumber).toBe('INV-003151');
  expect(await issue('2025-01-11')).toBe('INV-003151');
  expect(await problems(save({ prefix: 'INV-', resetPolicy: 'NEVER', paddingLength: 6, nextNumber: 3151 }))).toEqual([
    'INV-003151 is already issued, so the next number must be 3152 or higher.',
  ]);
});

it('NM-03: yearly puts the invoice date’s year in the number and restarts the count', async () => {
  const set = await save({ prefix: 'INV-', resetPolicy: 'YEARLY', paddingLength: 4, nextNumber: 1 });
  expect(set.nextInvoiceNumber).toBe('INV-2025-0001');
  expect(await issue('2025-01-12')).toBe('INV-2025-0001');
  expect(await issue('2025-01-13')).toBe('INV-2025-0002');
  expect((await numbering.get(env.identity, new Date('2026-01-02'))).nextInvoiceNumber).toBe('INV-2026-0001');
});

it('NM-04: monthly and daily restart per month and per day', async () => {
  await save({ prefix: 'INV-', resetPolicy: 'MONTHLY', paddingLength: 4, nextNumber: 1 });
  expect(await issue('2025-01-14')).toBe('INV-2025-01-0001');
  await save({ prefix: 'INV-', resetPolicy: 'DAILY', paddingLength: 3, nextNumber: 1 });
  expect(await issue('2025-01-15')).toBe('INV-2025-01-15-001');
  expect(await issue('2025-01-15')).toBe('INV-2025-01-15-002');
  expect(await issue('2025-01-16')).toBe('INV-2025-01-16-001');
});

it('NM-05: a bad format lists every problem and changes nothing', async () => {
  const before = await numbering.get(env.identity, today);
  expect(await problems(save({ prefix: 'IN V', resetPolicy: 'YEARLY', paddingLength: 2, nextNumber: 0 }))).toHaveLength(3);
  expect(await numbering.get(env.identity, today)).toEqual(before);
});
