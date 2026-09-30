/**
 * ADR-040 — AccountingSetupService unit tests. The repository is mocked: what is under test is the
 * orchestration (guards, what is passed where, the single transaction), not SQL. The DB-backed
 * suite `__tests__/setup.spec.ts` proves the writes and the rollback against Postgres.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AccountingSetupService, unrecordedAccountNumber, type InstallSetupInput } from './accounting-setup.service.js';

const identity = { activeOrganizationId: 'org1', userId: 'u1', permissions: ['*'] } as never;

const INPUT: InstallSetupInput = {
  templateId: 'CONSTRUCTION',
  vat: { charged: true, ratePercent: 5 },
  banks: [
    { accountName: 'Salaam operating', bankName: 'Salaam Somali Bank', accountNumber: '001' },
    { accountName: 'Dahabshiil', bankName: 'Dahabshiil Bank' },
  ],
  fiscalYear: { year: 2026, startMonth: 1 },
};

function build(opts: { accountsBefore?: number; accountsInTx?: number; failAt?: string } = {}) {
  const tx = { marker: 'tx' };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>, _opts?: unknown) => fn(tx)),
  };
  let counts = [opts.accountsBefore ?? 0, opts.accountsInTx ?? 0];
  const fail = (name: string) => {
    if (opts.failAt === name) throw new Error(`boom:${name}`);
  };
  type Args = unknown[];
  const repo = {
    countAccounts: jest.fn(async (..._a: Args) => (counts.length ? counts.shift()! : 0)),
    getStatusFacts: jest.fn(async (..._a: Args): Promise<unknown> => undefined),
    lockOrganization: jest.fn(async (..._a: Args) => fail('lock')),
    upsertPolicies: jest.fn(async (..._a: Args) => fail('policies')),
    createAccounts: jest.fn(async (...a: Args): Promise<Map<string, string>> => {
      fail('accounts');
      return new Map((a[2] as Array<{ code: string }>).map((x) => [x.code, `id-${x.code}`]));
    }),
    createPostingProfiles: jest.fn(async (...a: Args) => {
      fail('profiles');
      return (a[2] as unknown[]).length;
    }),
    createTaxCodes: jest.fn(async (...a: Args) => (a[2] as unknown[]).length),
    createFiscalYear: jest.fn(async (..._a: Args) => ({ id: 'fy1', name: 'FY2026' })),
    createBankAccounts: jest.fn(async (...a: Args) => (a[2] as unknown[]).length),
    ensureDocumentSequences: jest.fn(async (..._a: Args) => fail('sequences')),
    recordAudit: jest.fn(async (..._a: Args) => undefined),
  };
  const tenancy = { getClient: () => prisma };
  const config = { getBaseCurrency: jest.fn(async () => 'USD') };
  const service = new AccountingSetupService(tenancy as never, repo as never, config as never);
  return { service, repo, prisma, tx, setCounts: (c: number[]) => (counts = c) };
}

describe('AccountingSetupService.install', () => {
  it('installs everything inside ONE transaction, parent-first, and reports what it created', async () => {
    const { service, repo, prisma, tx } = build();
    const result = await service.install(identity, INPUT);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Every write received the transaction client, never the outer client.
    for (const fn of ['lockOrganization', 'upsertPolicies', 'createAccounts', 'createPostingProfiles', 'createTaxCodes', 'createFiscalYear', 'createBankAccounts', 'ensureDocumentSequences', 'recordAudit'] as const) {
      expect(repo[fn].mock.calls[0]![0]).toBe(tx);
    }

    const accounts = repo.createAccounts.mock.calls[0]![2] as Array<{ code: string; parentCode: string | null; name: string }>;
    const seen = new Set<string>();
    for (const a of accounts) {
      if (a.parentCode) expect(seen.has(a.parentCode)).toBe(true);
      seen.add(a.code);
    }
    expect(accounts.find((a) => a.code === '10100')?.name).toBe('Salaam operating');
    expect(accounts.find((a) => a.code === '10101')?.name).toBe('Dahabshiil');
    expect(seen.has('14100')).toBe(true);

    // Versions effective from the fiscal year start.
    expect((repo.createAccounts.mock.calls[0]![3] as Date).toISOString().slice(0, 10)).toBe('2026-01-01');
    // Policy start month follows the chosen fiscal year.
    expect(repo.upsertPolicies).toHaveBeenCalledWith(tx, 'org1', 1, 'u1');
    // Tax codes linked to output VAT 22000.
    expect(repo.createTaxCodes.mock.calls[0]![3]).toEqual({ outputTaxAccountId: 'id-22000' });
    // Retained earnings 31000 is the FY's closing account.
    expect(repo.createFiscalYear.mock.calls[0]![3]).toBe('id-31000');

    const banks = repo.createBankAccounts.mock.calls[0]![2] as Array<{ accountNumber: string; glAccountId: string }>;
    expect(banks).toEqual([
      expect.objectContaining({ accountNumber: '001', glAccountId: 'id-10100' }),
      expect.objectContaining({ accountNumber: unrecordedAccountNumber('10101'), glAccountId: 'id-10101' }),
    ]);

    expect(result).toEqual({
      accountsCreated: accounts.length,
      postingProfilesCreated: (repo.createPostingProfiles.mock.calls[0]![2] as unknown[]).length,
      fiscalYear: { id: 'fy1', name: 'FY2026' },
      bankAccountsCreated: 2,
      taxCodesCreated: 2,
    });
    expect(repo.recordAudit).toHaveBeenCalledTimes(1);
  });

  it('409 ACCOUNTING_ALREADY_SET_UP when the chart already has an account — nothing is written', async () => {
    const { service, repo, prisma } = build({ accountsBefore: 3 });
    await expect(service.install(identity, INPUT)).rejects.toMatchObject({
      response: { errorCode: 'ACCOUNTING_ALREADY_SET_UP' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(repo.createAccounts).not.toHaveBeenCalled();
  });

  it('re-checks under the lock: a concurrent install that committed first → 409, no writes', async () => {
    const { service, repo } = build({ accountsBefore: 0, accountsInTx: 78 });
    await expect(service.install(identity, INPUT)).rejects.toBeInstanceOf(ConflictException);
    expect(repo.lockOrganization).toHaveBeenCalled();
    expect(repo.upsertPolicies).not.toHaveBeenCalled();
  });

  it('a unique violation from a racing install is reported as 409 once the chart is non-empty', async () => {
    const { service, repo, setCounts } = build();
    repo.createAccounts.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    setCounts([0, 0, 78]);
    await expect(service.install(identity, INPUT)).rejects.toMatchObject({
      response: { errorCode: 'ACCOUNTING_ALREADY_SET_UP' },
    });
  });

  it('a failure part-way propagates out of the transaction (so Prisma rolls it back) and skips the audit', async () => {
    const { service, repo } = build({ failAt: 'sequences' });
    await expect(service.install(identity, INPUT)).rejects.toThrow('boom:sequences');
    expect(repo.recordAudit).not.toHaveBeenCalled();
  });

  it('no VAT: no tax codes, no 14100 — output VAT 22000 still exists', async () => {
    const { service, repo } = build();
    const result = await service.install(identity, { ...INPUT, vat: { charged: false } });
    expect(repo.createTaxCodes).not.toHaveBeenCalled();
    expect(result.taxCodesCreated).toBe(0);
    const codes = (repo.createAccounts.mock.calls[0]![2] as Array<{ code: string }>).map((a) => a.code);
    expect(codes).not.toContain('14100');
    expect(codes).toContain('22000');
  });

  it('no banks: only petty cash, no BankAccount rows', async () => {
    const { service, repo } = build();
    const result = await service.install(identity, { ...INPUT, banks: [] });
    expect(result.bankAccountsCreated).toBe(0);
    const cash = (repo.createAccounts.mock.calls[0]![2] as Array<{ accountSubtype: string; code: string }>)
      .filter((a) => a.accountSubtype === 'CASH_AND_BANK').map((a) => a.code);
    expect(cash).toEqual(['10900']);
  });

  it('a non-January fiscal year: FY2026/27 from 1 April, policy start month 4', async () => {
    const { service, repo, tx } = build();
    await service.install(identity, { ...INPUT, fiscalYear: { year: 2026, startMonth: 4 } });
    const plan = repo.createFiscalYear.mock.calls[0]![2] as { name: string; startDate: Date; endDate: Date };
    expect(plan.name).toBe('FY2026/27');
    expect(plan.endDate.toISOString().slice(0, 10)).toBe('2027-03-31');
    expect(repo.upsertPolicies).toHaveBeenCalledWith(tx, 'org1', 4, 'u1');
  });

  it.each([
    ['VAT charged without a rate', { ...INPUT, vat: { charged: true } }],
    ['VAT rate over 100', { ...INPUT, vat: { charged: true, ratePercent: 101 } }],
    ['a duplicate bank account number', { ...INPUT, banks: [INPUT.banks[0]!, { ...INPUT.banks[0]!, accountName: 'Other' }] }],
    ['a blank bank name', { ...INPUT, banks: [{ accountName: 'A', bankName: '  ' }] }],
    ['21 banks', { ...INPUT, banks: Array.from({ length: 21 }, (_, i) => ({ accountName: `B${i}`, bankName: 'X' })) }],
    ['fiscal year 1999', { ...INPUT, fiscalYear: { year: 1999, startMonth: 1 } }],
    ['start month 13', { ...INPUT, fiscalYear: { year: 2026, startMonth: 13 } }],
  ])('400 on %s, before touching the database', async (_label, input) => {
    const { service, repo } = build();
    await expect(service.install(identity, input as InstallSetupInput)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.countAccounts).not.toHaveBeenCalled();
  });
});

describe('AccountingSetupService.getStatus / getTemplate', () => {
  it('canInstall only while the chart is empty', async () => {
    const { service, repo } = build();
    repo.getStatusFacts.mockResolvedValueOnce({ accountCount: 0, hasFiscalYear: false, hasPolicies: false });
    await expect(service.getStatus(identity)).resolves.toEqual({
      canInstall: true, reason: 'READY', accountCount: 0, hasFiscalYear: false, hasPolicies: false,
    });
    repo.getStatusFacts.mockResolvedValueOnce({ accountCount: 4, hasFiscalYear: true, hasPolicies: true });
    await expect(service.getStatus(identity)).resolves.toMatchObject({ canInstall: false, reason: 'CHART_NOT_EMPTY', accountCount: 4 });
  });

  it('previews bank placeholders and the VAT row per the query', () => {
    const { service } = build();
    const t = service.getTemplate({ vatRate: 5, banks: 2 });
    expect(t.templateId).toBe('CONSTRUCTION');
    expect(t.accounts.filter((a) => a.conditional === 'BANK').map((a) => [a.code, a.name])).toEqual([
      ['10100', 'Bank 1'],
      ['10101', 'Bank 2'],
    ]);
    expect(t.accounts.find((a) => a.code === '14100')?.conditional).toBe('VAT');
    // Contract fields only — no internal posting policy leaks into the preview.
    expect(Object.keys(t.accounts[0]!).sort()).toEqual(
      ['accountClass', 'accountSubtype', 'code', 'isControlAccount', 'isHeading', 'name', 'normalBalance', 'parentCode'].sort(),
    );

    const none = service.getTemplate({});
    expect(none.accounts.some((a) => a.conditional)).toBe(false);
    expect(service.getTemplate({ vatRate: 0 }).accounts.some((a) => a.code === '14100')).toBe(false);
  });
});
