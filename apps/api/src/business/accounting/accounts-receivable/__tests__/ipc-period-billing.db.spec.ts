/**
 * ADR-046 §5 — IPC invoices bill the period, net of retention and advance recovery (live DB).
 *
 *   IPB-01  first certificate: invoice bills it whole; AR = amount due, retention and advance
 *           recovery post to their own accounts, and the journal balances
 *   IPB-02  second (cumulative) certificate: invoice bills only the period
 *   IPB-03  reversing the second invoice returns retention and advance to the first invoice's level
 *   IPB-04  a certificate already fully billed is refused and creates no invoice
 *   IPB-05  retention without a Retention Receivable account fails the post and names the role
 *   IPB-06  the read-only billing check flags a contract a legacy (cumulative) invoice over-billed
 *   IPB-07  the retention release invoice waits for the release and for unposted retention invoices
 *   IPB-08  the release invoice bills the retention held, moves it from Retention Receivable to AR
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { IpcBillingCheckService } from '../application/ipc-billing-check.service';
import { ClientInvoiceRepository } from '../infrastructure/client-invoice.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let contractId: string;
let retentionAccountId: string;
let clientAdvanceAccountId: string;

const d = (n: number | string) => new Decimal(n);

async function mkAccount(code: string, normalBalance: 'DEBIT' | 'CREDIT', accountClass: string, subtype: string) {
  const account = await prisma.account.create({
    data: { id: `${env.orgId}-${code}`, organizationId: env.orgId, code, normalBalance, createdBy: env.identity.userId },
  });
  await prisma.accountVersion.create({
    data: {
      accountId: account.id,
      versionNumber: 1,
      name: `${code} Account`,
      accountClass: accountClass as never,
      accountSubtype: subtype as never,
      isPostingAllowed: true,
      isControlAccount: false,
      controlPostingPolicy: 'UNRESTRICTED',
      effectiveFrom: new Date('2020-01-01'),
      changedBy: env.identity.userId,
    },
  });
  return account.id;
}

/** An effective certificate with cumulative figures to date. */
async function mkCertificate(onContract: string, applicationNumber: number, gross: number, retention: number, advance: number) {
  const ipa = await prisma.interimPaymentApplication.create({
    data: { organizationId: env.orgId, contractId: onContract, applicationNumber, status: 'SUBMITTED', createdBy: env.identity.userId },
  });
  const deductions = [
    ...(retention > 0 ? [{ deductionType: 'RETENTION', basis: d(gross), amount: d(retention) }] : []),
    ...(advance > 0 ? [{ deductionType: 'ADVANCE_RECOVERY', basis: d(gross), amount: d(advance) }] : []),
  ];
  const ipc = await prisma.interimPaymentCertificate.create({
    data: {
      organizationId: env.orgId,
      applicationId: ipa.id,
      certificateNumber: 1,
      status: 'CERTIFIED',
      isEffective: true,
      effectiveAt: new Date(),
      certifiedTotal: d(gross),
      currency: 'USD',
      createdBy: env.identity.userId,
      deductions: { create: deductions },
    },
  });
  return ipc.id;
}

async function invoiceAndPost(ipcId: string) {
  const invoice = await svc.clientInvoiceService.generateFromIpc(env.identity, {
    ipcId,
    invoiceDate: env.periods.openStart.toISOString().slice(0, 10),
    dueDate: env.periods.openEnd.toISOString().slice(0, 10),
  });
  await svc.clientInvoiceService.approve(env.identity, invoice.id);
  await svc.clientInvoiceService.post(env.identity, { invoiceId: invoice.id });
  return prisma.clientInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
}

const balance = (accountId: string) => svc.journalRepo.getGlBalance(prisma as never, env.orgId, accountId);

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  retentionAccountId = await mkAccount('11100', 'DEBIT', 'ASSET', 'RETENTION_RECEIVABLE');
  clientAdvanceAccountId = await mkAccount('21000', 'CREDIT', 'LIABILITY', 'CLIENT_ADVANCE_LIABILITY');
  await mkAccount('22000', 'CREDIT', 'LIABILITY', 'VAT_OUTPUT_PAYABLE'); // the fixture org charges 5% sales tax
  // One contract per project: the scenarios run in order on the fixture's contract. Its own
  // certificate is never invoiced here, so it never counts as billed.
  contractId = (await prisma.contract.findFirstOrThrow({ where: { organizationId: env.orgId } })).id;
}, 60_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

let secondInvoiceId: string;

it('IPB-01: the first certificate is billed whole, net of retention and advance recovery', async () => {
  const arBefore = await balance(env.accounts.arId);
  const ipcId = await mkCertificate(contractId, 1, 100_000, 5_000, 10_000);

  const inv = await invoiceAndPost(ipcId);

  expect(inv.certifiedGrossAmount?.toFixed(2)).toBe('100000.00');
  expect(inv.subtotal.toFixed(2)).toBe('100000.00');
  expect(inv.retentionAmount.toFixed(2)).toBe('5000.00');
  expect(inv.advanceRecoveryAmount.toFixed(2)).toBe('10000.00');
  const due = inv.subtotal.plus(inv.vatAmount).minus(15_000);
  expect(inv.totalAmount.toFixed(2)).toBe(due.toFixed(2));
  expect(inv.outstandingAmount.toFixed(2)).toBe(due.toFixed(2));

  expect((await balance(env.accounts.arId)).minus(arBefore).toFixed(2)).toBe(due.toFixed(2));
  expect((await balance(retentionAccountId)).toFixed(2)).toBe('5000.00');
  expect((await balance(clientAdvanceAccountId)).abs().toFixed(2)).toBe('10000.00');

  const journal = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: inv.postedJournalEntryId! },
    include: { lines: true },
  });
  const dr = journal.lines.reduce((s, l) => s.plus(l.debitAmount), d(0));
  const cr = journal.lines.reduce((s, l) => s.plus(l.creditAmount), d(0));
  expect(dr.toFixed(2)).toBe(cr.toFixed(2));
});

it('IPB-02: the second, cumulative certificate is billed for the period only', async () => {
  const ipcId = await mkCertificate(contractId, 2, 250_000, 12_500, 25_000);

  const inv = await invoiceAndPost(ipcId);
  secondInvoiceId = inv.id;

  expect(inv.certifiedGrossAmount?.toFixed(2)).toBe('150000.00');
  expect(inv.subtotal.toFixed(2)).toBe('150000.00');
  expect(inv.retentionAmount.toFixed(2)).toBe('7500.00');
  expect(inv.advanceRecoveryAmount.toFixed(2)).toBe('15000.00');
  expect(inv.totalAmount.toFixed(2)).toBe(inv.subtotal.plus(inv.vatAmount).minus(22_500).toFixed(2));
  expect((await balance(retentionAccountId)).toFixed(2)).toBe('12500.00');
});

it('IPB-03: reversing the second invoice takes retention back to the first invoice level', async () => {
  await svc.clientInvoiceService.reverse(env.identity, secondInvoiceId, {
    reversalDate: env.periods.openStart.toISOString().slice(0, 10),
    reason: 'IPB-03',
  });

  expect((await balance(retentionAccountId)).toFixed(2)).toBe('5000.00');
  expect((await balance(clientAdvanceAccountId)).abs().toFixed(2)).toBe('10000.00');
});

it('IPB-04: a certificate already fully billed is refused and creates no invoice', async () => {
  // After IPB-03 only the first invoice stands: 100,000 gross billed.
  const repeat = await mkCertificate(contractId, 3, 100_000, 5_000, 10_000);

  await expect(
    svc.clientInvoiceService.generateFromIpc(env.identity, {
      ipcId: repeat,
      invoiceDate: env.periods.openStart.toISOString().slice(0, 10),
      dueDate: env.periods.openEnd.toISOString().slice(0, 10),
    }),
  ).rejects.toThrow(/Nothing new to bill/);
  expect(await prisma.clientInvoice.count({ where: { sourceIpcId: repeat } })).toBe(0);
});

it('IPB-05: retention with no Retention Receivable account fails the post and names the role', async () => {
  await prisma.account.update({ where: { id: retentionAccountId }, data: { status: 'INACTIVE' } });
  try {
    const ipcId = await mkCertificate(contractId, 4, 140_000, 7_000, 14_000);
    const invoice = await svc.clientInvoiceService.generateFromIpc(env.identity, {
      ipcId,
      invoiceDate: env.periods.openStart.toISOString().slice(0, 10),
      dueDate: env.periods.openEnd.toISOString().slice(0, 10),
    });
    expect(invoice.retentionAmount.toFixed(2)).toBe('2000.00');
    await svc.clientInvoiceService.approve(env.identity, invoice.id);

    await expect(svc.clientInvoiceService.post(env.identity, { invoiceId: invoice.id })).rejects.toThrow(
      /RETENTION_RECEIVABLE/,
    );
  } finally {
    await prisma.account.update({ where: { id: retentionAccountId }, data: { status: 'ACTIVE' } });
  }
});

it('IPB-06: the billing check lists a contract a legacy invoice over-billed, by how much', async () => {
  const check = new IpcBillingCheckService({ getClient: () => prisma } as never, new ClientInvoiceRepository());
  // Before: posted IPC invoices bill 85,000 net (IPB-01); the latest certificate (IPB-05) certifies
  // 140,000 − 7,000 − 14,000 = 119,000 net. Nothing over-billed.
  expect(await check.findOverBilledContracts(env.identity)).toEqual([]);

  // A pre-ADR-046 invoice that billed certificate 3's cumulative 200,000 gross, nothing netted.
  const cert3 = await prisma.interimPaymentCertificate.findFirstOrThrow({
    where: { organizationId: env.orgId, application: { contractId, applicationNumber: 3 } },
  });
  await prisma.clientInvoice.create({
    data: {
      organizationId: env.orgId,
      clientId: env.clientId,
      contractId,
      sourceIpcId: cert3.id,
      invoiceDate: env.periods.openStart,
      dueDate: env.periods.openEnd,
      currencyCode: 'USD',
      subtotal: d(200_000),
      vatAmount: d(0),
      totalAmount: d(200_000),
      outstandingAmount: d(200_000),
      billingAddressSnapshot: {},
      documentStatus: 'APPROVED',
      postingStatus: 'POSTED',
      createdBy: env.identity.userId,
    },
  });

  const findings = await check.findOverBilledContracts(env.identity);
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({
    contractId,
    netCertifiedToDate: '119000.00',
    netBilled: '285000.00', // 85,000 + 200,000
    overBilledBy: '166000.00',
    invoiceCount: 2,
  });
});

const releaseDto = () => ({
  contractId,
  invoiceDate: env.periods.openStart.toISOString().slice(0, 10),
  dueDate: env.periods.openEnd.toISOString().slice(0, 10),
});

it('IPB-07: retention cannot be invoiced before it is released, or while certificate invoices holding it are unposted', async () => {
  await expect(svc.clientInvoiceService.generateFromRetentionRelease(env.identity, releaseDto())).rejects.toThrow(
    /Release the contract/,
  );

  await prisma.contractRetentionTerms.upsert({
    where: { contractId },
    create: { contractId, retentionRate: 0.05, retentionCap: 0.1, retentionSplitOnPC: 0.5, retentionReleasedAt: new Date() },
    update: { retentionReleasedAt: new Date() },
  });
  // IPB-05 left a certificate-4 invoice holding 2,000 of retention unposted.
  await expect(svc.clientInvoiceService.generateFromRetentionRelease(env.identity, releaseDto())).rejects.toThrow(
    /not posted/,
  );
});

it('IPB-08: the release invoice bills the retention held, clears Retention Receivable into AR, and is raised once', async () => {
  await prisma.clientInvoice.updateMany({
    where: { organizationId: env.orgId, contractId, sourceIpcId: { not: null }, postingStatus: { not: 'POSTED' } },
    data: { documentStatus: 'CANCELLED' },
  });
  const arBefore = await balance(env.accounts.arId);
  // Posted: the IPB-01 invoice (5,000 retention) and the legacy one (none); IPB-02's was reversed.
  expect((await balance(retentionAccountId)).toFixed(2)).toBe('5000.00');

  const draft = await svc.clientInvoiceService.generateFromRetentionRelease(env.identity, releaseDto());
  expect(draft.subtotal.toFixed(2)).toBe('0.00');
  expect(draft.vatAmount.toFixed(2)).toBe('0.00');
  expect(draft.retentionReleasedAmount.toFixed(2)).toBe('5000.00');
  expect(draft.totalAmount.toFixed(2)).toBe('5000.00');

  await svc.clientInvoiceService.approve(env.identity, draft.id);
  await svc.clientInvoiceService.post(env.identity, { invoiceId: draft.id });

  expect((await balance(retentionAccountId)).toFixed(2)).toBe('0.00');
  expect((await balance(env.accounts.arId)).minus(arBefore).toFixed(2)).toBe('5000.00');
  const again = await svc.clientInvoiceService.generateFromRetentionRelease(env.identity, releaseDto());
  expect(again.id).toBe(draft.id);
  const detail = await svc.clientInvoiceService.findById(env.identity, draft.id);
  expect(detail.source).toEqual({ kind: 'RETENTION_RELEASE', label: 'CTR-001', id: contractId });
});
