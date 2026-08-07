/**
 * INV — Accounting Invariants
 *
 *   INV-01  Document numbers are sequential (JE-000001, JE-000002, …)
 *   INV-02  SYSTEM_ONLY control account blocks a MANUAL posting origin
 *   INV-03  Idempotent posting: same (sourceDocumentType, sourceDocumentId, eventType)
 *           returns the same journalEntryId without creating a duplicate
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AccountingFixtureFactory, AccountingTestEnv } from './helpers/fixture.factory';
import { buildServices, AccountingServices } from './helpers/build-services';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
});

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

// ─── INV-01 ───────────────────────────────────────────────────────────────────
it('INV-01: document numbers are sequential (JE-000001, JE-000002, …)', async () => {
  const post = (id: string) =>
    prisma.$transaction((tx) =>
      svc.postingService.post(
        {
          organizationId: env.orgId,
          accountingDate: env.periods.openStart,
          documentDate:   env.periods.openStart,
          description:    `INV-01 seq test ${id}`,
          currencyCode:   'USD',
          eventType:      `EVT-INV-01-${id}`,
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId:   `inv-01-${id}`,
          journalCategory:    'GENERAL',
          entryPurpose:       'NORMAL',
          postingOrigin:      'MANUAL',
          createdBy:          env.identity.userId,
          lines: [
            { accountId: env.accounts.revId, debitAmount: new Decimal('10'), creditAmount: new Decimal(0), transactionCurrencyCode: 'USD', baseCurrencyAmount: new Decimal('10') },
            { accountId: env.accounts.expId, debitAmount: new Decimal(0), creditAmount: new Decimal('10'), transactionCurrencyCode: 'USD', baseCurrencyAmount: new Decimal('10') },
          ],
        },
        tx as never,
      ),
    );

  const r1 = await post('a');
  const r2 = await post('b');
  const r3 = await post('c');

  const nums = [r1.journalNumber, r2.journalNumber, r3.journalNumber];
  // All must start with the prefix
  expect(nums.every((n) => n.startsWith('JE-'))).toBe(true);

  // Extract numeric suffixes and verify they are strictly increasing
  const values = nums.map((n) => parseInt(n.replace('JE-', ''), 10));
  expect(values[1]).toBe(values[0] + 1);
  expect(values[2]).toBe(values[1] + 1);
});

// ─── INV-02 ───────────────────────────────────────────────────────────────────
it('INV-02: SYSTEM_ONLY control account blocks MANUAL posting origin', async () => {
  await expect(
    prisma.$transaction((tx) =>
      svc.postingService.post(
        {
          organizationId: env.orgId,
          accountingDate: env.periods.openStart,
          documentDate:   env.periods.openStart,
          description:    'INV-02 control account test',
          currencyCode:   'USD',
          eventType:      `EVT-INV-02-${Date.now()}`,
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId:   `inv-02-${Date.now()}`,
          journalCategory:    'GENERAL',
          entryPurpose:       'NORMAL',
          postingOrigin:      'MANUAL',
          createdBy:          env.identity.userId,
          lines: [
            { accountId: env.accounts.ctrlId, debitAmount: new Decimal('100'), creditAmount: new Decimal(0), transactionCurrencyCode: 'USD', baseCurrencyAmount: new Decimal('100') },
            { accountId: env.accounts.expId,  debitAmount: new Decimal(0), creditAmount: new Decimal('100'), transactionCurrencyCode: 'USD', baseCurrencyAmount: new Decimal('100') },
          ],
        },
        tx as never,
      ),
    ),
  ).rejects.toThrow(/system-only|control account|manual/i);
});

// ─── INV-03 ───────────────────────────────────────────────────────────────────
it('INV-03: idempotent posting returns the same journalEntryId on repeat call', async () => {
  const docId    = `inv-03-${Date.now()}`;
  const eventType = 'EVT-INV-03-IDEMPOTENT';

  const buildCommand = () => ({
    organizationId: env.orgId,
    accountingDate: env.periods.openStart,
    documentDate:   env.periods.openStart,
    description:    'INV-03 idempotency test',
    currencyCode:   'USD',
    eventType,
    sourceDocumentType: 'MANUAL_JOURNAL' as const,
    sourceDocumentId:   docId,
    journalCategory:    'GENERAL' as const,
    entryPurpose:       'NORMAL' as const,
    postingOrigin:      'MANUAL' as const,
    createdBy:          env.identity.userId,
    lines: [
      { accountId: env.accounts.revId, debitAmount: new Decimal('200'), creditAmount: new Decimal(0), transactionCurrencyCode: 'USD', baseCurrencyAmount: new Decimal('200') },
      { accountId: env.accounts.expId, debitAmount: new Decimal(0), creditAmount: new Decimal('200'), transactionCurrencyCode: 'USD', baseCurrencyAmount: new Decimal('200') },
    ],
  });

  const first  = await prisma.$transaction((tx) => svc.postingService.post(buildCommand(), tx as never));
  const second = await prisma.$transaction((tx) => svc.postingService.post(buildCommand(), tx as never));

  expect(second.journalEntryId).toBe(first.journalEntryId);
  expect(second.journalNumber).toBe(first.journalNumber);

  // Only one entry should exist
  const count = await prisma.journalEntry.count({
    where: { organizationId: env.orgId, sourceDocumentId: docId, accountingEventId: eventType },
  });
  expect(count).toBe(1);
});
