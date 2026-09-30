/**
 * ST — ADR-040 accounting setup from a template, against Postgres.
 *
 *   ST-01  install on an empty org creates the full, postable configuration (readiness ready,
 *          every resolver role resolves, banks linked, VAT codes, 12 OPEN periods, sequences, audit)
 *   ST-02  a second install is refused 409 ACCOUNTING_ALREADY_SET_UP and writes nothing
 *   ST-03  a failure part-way rolls the WHOLE install back (no accounts, no policies, no profiles)
 *   ST-04  re-pointing a posting profile closes the previous version at the new date — the
 *          non-overlap constraint accepts it and a bill-date lookup resolves each side correctly
 *   ST-05  deactivate / reactivate a profile; deactivation blocked while an unposted bill names it
 *   ST-06  posting a supplier bill whose line names an INCOME profile is refused (review M1)
 *   ST-07  a future fiscal year: versions start today and a chart edit succeeds (review M2);
 *          an overlapping fiscal year is a 409, not a constraint 500 (review L4)
 *   ST-08  records without a chart → PARTIAL_SETUP / 409 ACCOUNTING_PARTIALLY_SET_UP (review L6)
 *   ST-09  three concurrent installs → exactly one succeeds, two 409
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { RequestIdentity } from '@erp/types';

import { AccountingConfigurationRepository } from '../accounting-core/infrastructure/accounting-configuration.repository';
import { FiscalYearRepository } from '../accounting-core/infrastructure/fiscal-year.repository';
import { BankAccountRepository } from '../accounting-core/infrastructure/bank-account.repository';
import { DocumentSequenceRepository } from '../accounting-core/infrastructure/document-sequence.repository';
import { AccountRepository } from '../accounting-core/infrastructure/account.repository';
import { AccountingReadinessService } from '../accounting-core/application/accounting-readiness.service';
import { PostingAccountResolver } from '../accounting-core/application/posting-account-resolver.service';
import { AccountingSetupRepository } from '../accounting-setup/infrastructure/accounting-setup.repository';
import { AccountingSetupService } from '../accounting-setup/application/accounting-setup.service';
import { RESOLVER_SUBTYPES } from '../accounting-setup/templates/construction';
import { PostingProfileRepository } from '../accounts-payable/infrastructure/posting-profile.repository';
import { PostingProfileService } from '../accounts-payable/application/posting-profile.service';
import { AccountService } from '../accounting-core/application/account.service';
import { FiscalYearService } from '../accounting-core/application/fiscal-year.service';
import { AccountingConfigurationService } from '../accounting-core/application/accounting-configuration.service';
import { Decimal } from '@prisma/client/runtime/library';
import { buildServices } from './helpers/build-services';

const prisma = new PrismaClient();
const tenancy = { getClient: () => prisma } as never;
const YEAR = new Date().getUTCFullYear(); // so today's period exists and readiness can be READY

const orgs: string[] = [];

async function makeOrg(): Promise<RequestIdentity> {
  const suffix = `st${randomUUID().slice(0, 12)}`;
  const orgId = `test-org-${suffix}`;
  await prisma.organization.create({ data: { id: orgId, name: `Setup ${suffix}`, slug: `test-${suffix}`, status: 'ACTIVE' } });
  const user = await prisma.user.create({
    data: { email: `setup-${suffix}@st.test`, passwordHash: 'x', firstName: 'Setup', lastName: 'ST', organizationId: orgId },
  });
  orgs.push(orgId);
  return { userId: user.id, activeOrganizationId: orgId, tenantSlug: `test-${suffix}`, roles: ['admin'], permissions: ['*'] };
}

function makeSetup(repoOverride?: (repo: AccountingSetupRepository) => void) {
  const repo = new AccountingSetupRepository(
    new AccountingConfigurationRepository(),
    new FiscalYearRepository(),
    new BankAccountRepository(),
    new DocumentSequenceRepository(),
  );
  repoOverride?.(repo);
  const config = { getBaseCurrency: async () => 'USD' };
  return new AccountingSetupService(tenancy, repo, config as never);
}

const INPUT = {
  templateId: 'CONSTRUCTION' as const,
  vat: { charged: true, ratePercent: 5 },
  banks: [
    { accountName: 'Salaam operating', bankName: 'Salaam Somali Bank', accountNumber: `ST-${randomUUID().slice(0, 8)}` },
    { accountName: 'Dahabshiil', bankName: 'Dahabshiil Bank International' },
  ],
  fiscalYear: { year: YEAR, startMonth: 1 },
};

async function cleanup(orgId: string) {
  const q = (sql: TemplateStringsArray, ...v: unknown[]) => prisma.$executeRaw(sql, ...v);
  await prisma.auditLog.deleteMany({ where: { orgId } });
  await q`DELETE FROM supplier_bill_lines WHERE supplier_bill_id IN (SELECT id FROM supplier_bills WHERE organization_id = ${orgId})`;
  await q`DELETE FROM supplier_bills WHERE organization_id = ${orgId}`;
  await q`DELETE FROM suppliers WHERE organization_id = ${orgId}`;
  await q`DELETE FROM bank_accounts WHERE organization_id = ${orgId}`;
  await q`DELETE FROM posting_profile_versions WHERE posting_profile_id IN (SELECT id FROM posting_profiles WHERE organization_id = ${orgId})`;
  await q`DELETE FROM posting_profiles WHERE organization_id = ${orgId}`;
  await q`DELETE FROM tax_codes WHERE organization_id = ${orgId}`;
  await q`DELETE FROM accounting_periods WHERE organization_id = ${orgId}`;
  await q`DELETE FROM fiscal_years WHERE organization_id = ${orgId}`;
  await q`DELETE FROM document_number_sequences WHERE organization_id = ${orgId}`;
  await q`DELETE FROM account_versions WHERE account_id IN (SELECT id FROM accounts WHERE organization_id = ${orgId})`;
  await q`DELETE FROM accounts WHERE organization_id = ${orgId}`;
  await q`DELETE FROM fiscal_calendar_policy WHERE organization_id = ${orgId}`;
  await q`DELETE FROM tax_policy WHERE organization_id = ${orgId}`;
  await q`DELETE FROM numbering_policy WHERE organization_id = ${orgId}`;
  await q`DELETE FROM posting_policy WHERE organization_id = ${orgId}`;
  await q`DELETE FROM dimension_policy WHERE organization_id = ${orgId}`;
  await q`DELETE FROM banking_policy WHERE organization_id = ${orgId}`;
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await q`DELETE FROM organizations WHERE id = ${orgId}`;
}

let billSeq = 0;
/** An APPROVED, unposted, PO-less bill dated inside the installed fiscal year. */
async function approvedBill(who: RequestIdentity, profileCode: string) {
  const orgId = who.activeOrganizationId;
  const supplier =
    (await prisma.supplier.findFirst({ where: { organizationId: orgId } })) ??
    (await prisma.supplier.create({ data: { organizationId: orgId, code: 'SUP-ST', name: 'ST Supplier', status: 'ACTIVE' } }));
  billSeq += 1;
  const amount = new Decimal(100);
  return prisma.supplierBill.create({
    data: {
      organizationId: orgId,
      supplierId: supplier.id,
      supplierInvoiceNumber: `ST-${billSeq}`,
      supplierInvoiceNumberNorm: `ST${billSeq}`,
      billDate: new Date(`${YEAR}-03-15T00:00:00.000Z`),
      dueDate: new Date(`${YEAR}-04-15T00:00:00.000Z`),
      currencyCode: 'USD',
      subtotal: amount,
      vatAmount: new Decimal(0),
      totalAmount: amount,
      outstandingAmount: amount,
      documentStatus: 'APPROVED',
      postingStatus: 'NOT_POSTED',
      createdBy: who.userId,
      lines: {
        create: [{
          lineNumber: 1, description: 'ST line', netAmount: amount, vatAmount: new Decimal(0),
          grossAmount: amount, expenseProfileCode: profileCode,
        }],
      },
    },
  });
}

afterAll(async () => {
  for (const orgId of orgs) await cleanup(orgId);
  await prisma.$disconnect();
});

describe('ADR-040 accounting setup (DB)', () => {
  let identity: RequestIdentity;

  beforeAll(async () => {
    identity = await makeOrg();
  });

  it('ST-01: install creates a complete, postable configuration', async () => {
    const setup = makeSetup();
    expect((await setup.getStatus(identity)).canInstall).toBe(true);

    const result = await setup.install(identity, INPUT);
    const orgId = identity.activeOrganizationId;

    expect(result.fiscalYear.name).toBe(`FY${YEAR}`);
    expect(result.bankAccountsCreated).toBe(2);
    expect(result.taxCodesCreated).toBe(2);
    expect(result.accountsCreated).toBe(78 + 2 + 1); // chart + 2 banks + 14100
    expect(await prisma.account.count({ where: { organizationId: orgId } })).toBe(result.accountsCreated);
    expect(await prisma.postingProfile.count({ where: { organizationId: orgId } })).toBe(result.postingProfilesCreated);

    // Readiness — the checks the posting paths dereference — is fully satisfied.
    const readiness = await new AccountingReadinessService(tenancy).getReadiness(identity);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.ready).toBe(true);

    // Every resolver role resolves to exactly one account.
    const resolver = new PostingAccountResolver(new AccountRepository());
    for (const subtype of RESOLVER_SUBTYPES) {
      await expect(resolver.resolve(prisma, orgId, subtype)).resolves.toMatchObject({ code: expect.any(String) });
    }

    // Parent links were written.
    const cement = await prisma.account.findUnique({
      where: { organizationId_code: { organizationId: orgId, code: '51100' } },
      include: { versions: true },
    });
    const materials = await prisma.account.findUnique({ where: { organizationId_code: { organizationId: orgId, code: '51000' } } });
    expect(cement!.versions[0]!.parentAccountId).toBe(materials!.id);
    expect(cement!.versions[0]!.effectiveFrom.toISOString().slice(0, 10)).toBe(`${YEAR}-01-01`);

    // Banks: each on its own CASH_AND_BANK GL account; the unrecorded number is a unique placeholder.
    const banks = await prisma.bankAccount.findMany({ where: { organizationId: orgId }, include: { glAccount: true }, orderBy: { accountName: 'asc' } });
    expect(banks.map((b) => [b.glAccount.code, b.accountNumber, b.allowsReceipts, b.allowsPayments])).toEqual([
      ['10101', 'Not recorded (10101)', true, true],
      ['10100', INPUT.banks[0]!.accountNumber, true, true],
    ]);

    // VAT codes, linked into the tax policy.
    const codes = await prisma.taxCode.findMany({ where: { organizationId: orgId }, orderBy: { code: 'asc' } });
    expect(codes.map((c) => [c.code, c.recoveryMethod])).toEqual([['VAT5_IN', 'NON_RECOVERABLE'], ['VAT5_OUT', 'FULLY_RECOVERABLE']]);
    const taxPolicy = await prisma.taxPolicy.findUnique({ where: { organizationId: orgId } });
    expect(taxPolicy!.defaultOutputTaxCodeId).toBe(codes.find((c) => c.code === 'VAT5_OUT')!.id);

    // Fiscal year: OPEN, 12 OPEN monthly periods, retained earnings 31000.
    const fy = await prisma.fiscalYear.findUnique({ where: { id: result.fiscalYear.id }, include: { periods: true } });
    expect(fy!.status).toBe('OPEN');
    expect(fy!.periods).toHaveLength(12);
    expect(fy!.periods.every((p) => p.status === 'OPEN')).toBe(true);
    expect(fy!.endDate.toISOString().slice(0, 10)).toBe(`${YEAR}-12-31`);

    // Sequences for every accounting document type.
    const seqs = await prisma.documentNumberSequence.findMany({ where: { organizationId: orgId } });
    expect(seqs.map((s) => s.documentType).sort()).toEqual(
      ['CLIENT_INVOICE', 'CREDIT_NOTE', 'JOURNAL_ENTRY', 'PAYMENT_RECEIPT', 'SUPPLIER_BILL', 'SUPPLIER_PAYMENT'],
    );

    // One audit event summarising the install.
    const audits = await prisma.auditLog.findMany({ where: { orgId, action: 'ACCOUNTING_SETUP_INSTALLED' } });
    expect(audits).toHaveLength(1);

    expect(await setup.getStatus(identity)).toMatchObject({ canInstall: false, reason: 'CHART_NOT_EMPTY', hasFiscalYear: true, hasPolicies: true });
  });

  it('ST-02: a second install is refused 409 and writes nothing', async () => {
    const before = await prisma.account.count({ where: { organizationId: identity.activeOrganizationId } });
    await expect(makeSetup().install(identity, INPUT)).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'ACCOUNTING_ALREADY_SET_UP' },
    });
    expect(await prisma.account.count({ where: { organizationId: identity.activeOrganizationId } })).toBe(before);
  });

  it('ST-04: re-pointing a profile closes the previous version at the new date', async () => {
    const service = new PostingProfileService(tenancy, new PostingProfileRepository());
    const cement = (await service.list(identity)).find((p) => p.code === 'COST_51100')!;
    expect(cement.currentAccount).toMatchObject({ code: '51100', name: 'Cement and concrete' });

    const from = `${YEAR}-07-01`;
    const view = await service.repoint(identity, cement.id, { accountCode: '51200', effectiveFrom: from });
    const [v2, v1] = view.versions;
    expect(v2).toMatchObject({ versionNumber: 2, accountCode: '51200', effectiveTo: null });
    expect(v1!.effectiveTo!.toISOString().slice(0, 10)).toBe(from);

    // The same lookup SupplierBillService uses at post time.
    const resolveOn = async (day: string) => {
      const date = new Date(`${day}T00:00:00.000Z`);
      const v = await prisma.postingProfileVersion.findFirst({
        where: { postingProfileId: cement.id, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: date } }] },
        orderBy: { effectiveFrom: 'desc' },
      });
      return v?.versionNumber;
    };
    expect(await resolveOn(`${YEAR}-06-30`)).toBe(1);
    expect(await resolveOn(from)).toBe(2);

    // Not after the latest version → 400, nothing written.
    await expect(service.repoint(identity, cement.id, { accountCode: '51300', effectiveFrom: from })).rejects.toMatchObject({ status: 400 });

    // A new profile against a heading is refused.
    await expect(service.create(identity, { code: 'BAD_ONE', name: 'Bad', accountCode: '51000' }))
      .rejects.toMatchObject({ response: { errorCode: 'POSTING_PROFILE_ACCOUNT_INVALID' } });
    await expect(service.create(identity, { code: 'COST_51100', name: 'Dup', accountCode: '51100' }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('ST-05: deactivate and reactivate a profile; blocked while an unposted bill names it', async () => {
    const service = new PostingProfileService(tenancy, new PostingProfileRepository());
    const target = (await service.list(identity)).find((p) => p.code === 'EXP_61100')!;
    expect((await service.setActive(identity, target.id, false)).status).toBe('INACTIVE');
    expect((await service.setActive(identity, target.id, true)).status).toBe('ACTIVE');

    await approvedBill(identity, 'EXP_61100');
    await expect(service.setActive(identity, target.id, false)).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'POSTING_PROFILE_IN_USE', details: { unpostedBills: 1 } },
    });
  });

  it('ST-06: posting a bill whose line names an INCOME profile is refused; nothing is posted', async () => {
    const bill = await approvedBill(identity, 'INC_42100');
    const { supplierBillService } = buildServices(prisma);
    await expect(supplierBillService.post(identity, { billId: bill.id, apAccountCode: '20000' })).rejects.toMatchObject({
      status: 400,
      response: { errorCode: 'POSTING_PROFILE_NOT_EXPENSE' },
    });
    const after = await prisma.supplierBill.findUnique({ where: { id: bill.id } });
    // The post path records any refusal as FAILED (existing behaviour, same as an unknown profile).
    expect(after!.postingStatus).not.toBe('POSTED');
    expect(await prisma.journalEntry.count({ where: { organizationId: identity.activeOrganizationId } })).toBe(0);

    // Nor can the income profile be re-pointed into the cost family.
    const service = new PostingProfileService(tenancy, new PostingProfileRepository());
    const inc = (await service.list(identity)).find((p) => p.code === 'INC_42100')!;
    await expect(service.repoint(identity, inc.id, { accountCode: '51100', effectiveFrom: `${YEAR}-08-01` }))
      .rejects.toMatchObject({ response: { errorCode: 'POSTING_PROFILE_CLASS_CHANGE' } });
  });

  it('ST-07: a future fiscal year — versions start today, a chart edit succeeds, an overlap is 409', async () => {
    const who = await makeOrg();
    const next = YEAR + 1;
    await makeSetup().install(who, { ...INPUT, banks: [], fiscalYear: { year: next, startMonth: 1 } });
    const today = new Date().toISOString().slice(0, 10);
    const rent = await prisma.account.findUnique({
      where: { organizationId_code: { organizationId: who.activeOrganizationId, code: '61100' } },
      include: { versions: true },
    });
    expect(rent!.versions[0]!.effectiveFrom.toISOString().slice(0, 10)).toBe(today);

    const accounts = new AccountService(tenancy, new AccountRepository());
    const edited = await accounts.update(who, rent!.id, { name: 'Office and yard rent' });
    expect(edited!.versions[0]!.name).toBe('Office and yard rent');

    // L4: a July-start year overlapping FY<next> → 409 FISCAL_YEAR_OVERLAP, not a constraint 500.
    await prisma.fiscalCalendarPolicy.update({
      where: { organizationId: who.activeOrganizationId },
      data: { fiscalYearStartMonth: 7 },
    });
    const fiscalYears = new FiscalYearService(
      tenancy,
      new FiscalYearRepository(),
      new AccountRepository(),
      new AccountingConfigurationService(tenancy, new AccountingConfigurationRepository()),
    );
    await expect(fiscalYears.create(who, { year: next, retainedEarningsAccountCode: '31000' })).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'FISCAL_YEAR_OVERLAP' },
    });
  });

  it('ST-08: records without a chart → PARTIAL_SETUP and 409 ACCOUNTING_PARTIALLY_SET_UP', async () => {
    const who = await makeOrg();
    await prisma.taxCode.create({
      data: {
        organizationId: who.activeOrganizationId, code: 'VAT5_OUT', name: 'Output VAT 5%', rate: 5, taxType: 'VAT',
        recoveryMethod: 'FULLY_RECOVERABLE', effectiveFrom: new Date(`${YEAR}-01-01T00:00:00.000Z`), createdBy: who.userId,
      },
    });
    const setup = makeSetup();
    expect(await setup.getStatus(who)).toMatchObject({ canInstall: false, reason: 'PARTIAL_SETUP', existingRecords: ['TAX_CODES'] });
    await expect(setup.install(who, INPUT)).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'ACCOUNTING_PARTIALLY_SET_UP' },
    });
    expect(await prisma.account.count({ where: { organizationId: who.activeOrganizationId } })).toBe(0);
  });

  it('ST-09: three concurrent installs → exactly one succeeds, two are 409', async () => {
    const who = await makeOrg();
    const results = await Promise.allSettled([1, 2, 3].map(() => makeSetup().install(who, { ...INPUT, banks: [] })));
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(refused).toHaveLength(2);
    for (const r of refused) {
      expect(r.reason).toMatchObject({ status: 409, response: { errorCode: 'ACCOUNTING_ALREADY_SET_UP' } });
    }
    expect(await prisma.account.count({ where: { organizationId: who.activeOrganizationId } })).toBe(79);
  });

  it('ST-03: a failure part-way rolls the whole install back', async () => {
    const other = await makeOrg();
    const failing = makeSetup((repo) => {
      repo.ensureDocumentSequences = async () => {
        throw new Error('injected failure after accounts, profiles, FY and banks were written');
      };
    });
    await expect(failing.install(other, { ...INPUT, banks: [{ accountName: 'X', bankName: 'Y' }] })).rejects.toThrow('injected failure');

    const orgId = other.activeOrganizationId;
    expect(await prisma.account.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.postingProfile.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.fiscalYear.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.bankAccount.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.fiscalCalendarPolicy.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { orgId } })).toBe(0);
    expect((await makeSetup().getStatus(other)).canInstall).toBe(true);
  });
});
