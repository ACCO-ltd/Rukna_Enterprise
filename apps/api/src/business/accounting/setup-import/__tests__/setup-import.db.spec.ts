/**
 * Step 5 — importing suppliers and clients from a spreadsheet.
 *
 *   SI-01  the check names every problem, matches likely duplicates, and saves nothing
 *   SI-02  the import creates suppliers with generated codes, merges a duplicate, and records
 *          each balance as an OPENING_BALANCE bill that the AP tie-out counts
 *   SI-03  an import with errors is refused unless the reader chooses to skip those rows
 *   SI-04  clients come in with their primary contact and an open invoice for what they owe
 *   SI-05  permissions: the kind needs its own permission; balances need Manage accounting
 *   SI-06  once the opening journal is posted, balances are refused
 */

import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, type SetupImportRequest } from '@erp/types';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { ClientService } from '../../../../platform/clients/application/client.service';
import { ClientPrismaRepository } from '../../../../platform/clients/infrastructure/client-prisma.repository';
import { SupplierService } from '../../accounts-payable/application/supplier.service';
import { SupplierRepository } from '../../accounts-payable/infrastructure/supplier.repository';
import { SetupImportService } from '../application/setup-import.service';
import { SetupImportRepository } from '../infrastructure/setup-import.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let service: SetupImportService;
const day = '2026-01-01';
// The fixture's user is not a row in `users`, so audits are captured rather than written.
const audits: Array<{ resourceType: string; resourceId: string; eventType?: string }> = [];

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  const tenancy = { getClient: () => prisma } as never;
  const outbox = { record: async (_tx: unknown, command: (typeof audits)[number]) => { audits.push(command); } } as never;
  service = new SetupImportService(
    new SetupImportRepository(tenancy),
    new SupplierService(tenancy, new SupplierRepository(), outbox),
    new ClientService(tenancy, new ClientPrismaRepository(), outbox),
    outbox,
  );
}, 60_000);

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM client_code_sequences WHERE organization_id = ${env.orgId}`;
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

const req = (rows: SetupImportRequest['rows'], extra: Partial<SetupImportRequest> = {}): SetupImportRequest => ({
  rows, defaultCountry: 'KE', openingDate: day, ...extra,
});

it('SI-01: the check names every problem and matches duplicates, saving nothing', async () => {
  const existing = await prisma.supplier.findUniqueOrThrow({ where: { id: env.supplierId } });
  const before = await prisma.supplier.count({ where: { organizationId: env.orgId } });

  const check = await service.check(env.identity, 'suppliers', req([
    { name: 'Horn Cement', phone: '0712345678', paymentTerms: 'Net 30', openingBalance: '1,200.00' },
    { name: existing.name, openingBalance: '300' },
    { name: 'Bad Row', phone: '99', paymentTerms: 'soon' },
    { name: 'horn cement ltd' },
    { name: 'Owes us', openingBalance: '(50.00)' },
    { name: 'Skipped', action: 'SKIP' },
    { name: 'Taken', code: existing.code },
  ]));

  expect(check.rows.map((r) => r.status)).toEqual(['READY', 'WARNING', 'ERROR', 'WARNING', 'ERROR', 'SKIPPED', 'ERROR']);
  expect(check.rows[1].duplicateOf).toMatchObject({ id: existing.id });
  expect(check.rows[2].problems.map((p) => p.code)).toEqual(['PHONE_INVALID', 'PAYMENT_TERMS_UNKNOWN']);
  expect(check.rows[3].problems[0]).toMatchObject({ code: 'DUPLICATE_IN_FILE', message: 'The same as row 1 of this file' });
  expect(check.rows[4].problems[0].code).toBe('BALANCE_NEGATIVE');
  expect(check.rows[6].problems[0].code).toBe('CODE_TAKEN');
  expect(check.summary).toMatchObject({ total: 7, toCreate: 3, skipped: 1, withErrors: 3, withWarnings: 2, openingBalanceTotal: '1500.00', openingItems: 2 });
  expect(check.openingBalancesOpen).toBe(true);
  expect(await prisma.supplier.count({ where: { organizationId: env.orgId } })).toBe(before);
});

it('SI-02: suppliers are created, a duplicate merged, and balances recorded as opening bills', async () => {
  const existing = await prisma.supplier.findUniqueOrThrow({ where: { id: env.supplierId } });
  const result = await service.import(env.identity, 'suppliers', req([
    { name: 'Blue Nile Timber', taxNumber: 'TIN-77', phone: '+254712000111', contactName: 'Amina', paymentTerms: '30', openingBalance: '1,000.00' },
    { name: 'Gulf Fixings', code: 'GF-01' },
    { name: existing.name, action: 'MERGE', mergeIntoId: existing.id, openingBalance: '250.50' },
  ]));
  expect(result).toMatchObject({ created: 2, merged: 1, skipped: 0, openingItems: 2, openingBalanceTotal: '1250.50' });

  const timber = await prisma.supplier.findFirstOrThrow({ where: { organizationId: env.orgId, name: 'Blue Nile Timber' }, include: { contacts: true } });
  expect(timber.code).toMatch(/^SUP-\d{6}$/);
  expect(timber.paymentTermsDays).toBe(30);
  expect(timber.createdBy).toBe(env.identity.userId);
  expect(timber.contacts).toEqual([expect.objectContaining({ name: 'Amina', phone: '+254712000111', isPrimary: true })]);
  expect(await prisma.supplier.count({ where: { organizationId: env.orgId, code: 'GF-01' } })).toBe(1);

  const bills = await prisma.supplierBill.findMany({ where: { organizationId: env.orgId, migrationBatchId: result.batchReference }, orderBy: { totalAmount: 'desc' } });
  expect(bills.map((b) => [b.supplierId, b.totalAmount.toFixed(2), b.postingStatus, b.dueDate.toISOString().slice(0, 10)])).toEqual([
    [timber.id, '1000.00', 'OPENING_BALANCE', '2026-01-31'],
    [existing.id, '250.50', 'OPENING_BALANCE', '2026-01-01'],
  ]);
  expect(audits.filter((a) => a.resourceId === result.batchReference)).toEqual([expect.objectContaining({ eventType: 'SETUP_IMPORT_COMPLETED' })]);
  expect(audits.filter((a) => a.resourceType === 'Supplier' && a.resourceId === timber.id)).toHaveLength(1);
});

it('SI-03: errors refuse the import unless the reader skips those rows', async () => {
  const rows = [{ name: 'Good Supplier Two' }, { name: 'Bad', email: 'nope' }];
  await expect(service.import(env.identity, 'suppliers', req(rows))).rejects.toMatchObject({ response: { errorCode: 'IMPORT_HAS_ERRORS' } });
  expect(await prisma.supplier.count({ where: { organizationId: env.orgId, name: 'Good Supplier Two' } })).toBe(0);

  const result = await service.import(env.identity, 'suppliers', req(rows, { skipRowsWithErrors: true }));
  expect(result).toMatchObject({ created: 1, skipped: 1 });
  await expect(service.check(env.identity, 'suppliers', req([{ name: 'X', openingBalance: '5' }], { openingDate: undefined })))
    .rejects.toMatchObject({ response: { errorCode: 'OPENING_DATE_REQUIRED' } });
});

it('SI-04: clients come in with a primary contact and an open invoice for what they owe', async () => {
  const result = await service.import(env.identity, 'clients', req([
    { name: 'Coast Water Agency', contactName: 'Hassan', phone: '0722 000 222', clientType: 'Government', paymentTerms: '14', city: 'Mombasa', openingBalance: '5,400' },
  ]));
  expect(result).toMatchObject({ created: 1, openingItems: 1, openingBalanceTotal: '5400.00' });
  const client = await prisma.client.findFirstOrThrow({ where: { organizationId: env.orgId, name: 'Coast Water Agency' }, include: { contacts: true } });
  expect(client).toMatchObject({ type: 'GOVERNMENT', paymentTermsDays: 14, countryCode: 'KE', city: 'Mombasa' });
  expect(client.code).toMatch(/^CLI-/);
  expect(client.contacts).toEqual([expect.objectContaining({ name: 'Hassan', phone: '+254722000222', isPrimary: true })]);
  const invoice = await prisma.clientInvoice.findFirstOrThrow({ where: { clientId: client.id } });
  expect(invoice).toMatchObject({ postingStatus: 'OPENING_BALANCE', documentStatus: 'APPROVED', migrationBatchId: result.batchReference });
  expect(invoice.outstandingAmount.toFixed(2)).toBe('5400.00');
});

it('SI-05: each kind needs its own permission; balances need Manage accounting', async () => {
  const buyer = { ...env.identity, permissions: [PERMISSIONS.payablesManage] };
  await expect(service.check(buyer, 'clients', req([{ name: 'X' }]))).rejects.toMatchObject({ status: 403 });
  const check = await service.check(buyer, 'suppliers', req([{ name: 'No balance' }, { name: 'Balance', openingBalance: '10' }]));
  expect(check.rows.map((r) => r.status)).toEqual(['READY', 'ERROR']);
  expect(check.rows[1].problems[0].code).toBe('OPENING_BALANCES_FORBIDDEN');
});

it('SI-06: once the opening journal is posted, balances are refused', async () => {
  const marker = await prisma.journalEntry.create({
    data: {
      organizationId: env.orgId,
      journalNumber: `JE-SI06-${Date.now()}`,
      accountingDate: new Date(day),
      documentDate: new Date(day),
      description: 'Opening balance (test marker)',
      sourceDocumentType: 'OPENING_BALANCE',
      sourceDocumentId: 'SI-06',
      journalCategory: 'OPENING_BALANCE',
      entryPurpose: 'OPENING_BALANCE',
      currencyCode: 'USD',
      createdBy: env.identity.userId,
    } as never,
  });
  try {
    const check = await service.check(env.identity, 'suppliers', req([{ name: 'Late', openingBalance: '10' }]));
    expect(check.openingBalancesOpen).toBe(false);
    expect(check.rows[0].problems[0].code).toBe('OPENING_BALANCES_CLOSED');
  } finally {
    await prisma.journalEntry.delete({ where: { id: marker.id } });
  }
});
