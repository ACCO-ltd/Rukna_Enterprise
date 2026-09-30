/**
 * ADR-040 §4 — posting profile commands. Repository mocked; the DB suite
 * (`__tests__/setup.spec.ts`) proves the re-point against the non-overlap constraint.
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { PostingProfileService, toDateOnly } from './posting-profile.service.js';

const identity = { activeOrganizationId: 'org1', userId: 'u1' } as never;
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const ACCOUNTS: Record<string, { id: string; code: string; status: string; name: string; accountClass: string; isPostingAllowed: boolean }> = {
  '51100': { id: 'a51100', code: '51100', status: 'ACTIVE', name: 'Cement and concrete', accountClass: 'COST_OF_SALES', isPostingAllowed: true },
  '51200': { id: 'a51200', code: '51200', status: 'ACTIVE', name: 'Steel and reinforcement', accountClass: 'COST_OF_SALES', isPostingAllowed: true },
  '51000': { id: 'a51000', code: '51000', status: 'ACTIVE', name: 'Materials', accountClass: 'COST_OF_SALES', isPostingAllowed: false },
  '11000': { id: 'a11000', code: '11000', status: 'ACTIVE', name: 'AR', accountClass: 'ASSET', isPostingAllowed: false },
  '21100': { id: 'a21100', code: '21100', status: 'ACTIVE', name: 'Unapplied', accountClass: 'LIABILITY', isPostingAllowed: true },
  '42100': { id: 'a42100', code: '42100', status: 'ACTIVE', name: 'Equipment hire income', accountClass: 'INCOME', isPostingAllowed: true },
  '42200': { id: 'a42200', code: '42200', status: 'ACTIVE', name: 'Scrap sales', accountClass: 'INCOME', isPostingAllowed: true },
  '61100': { id: 'a61100', code: '61100', status: 'ACTIVE', name: 'Office rent', accountClass: 'EXPENSE', isPostingAllowed: true },
  '61900': { id: 'a61900', code: '61900', status: 'INACTIVE', name: 'Tendering', accountClass: 'EXPENSE', isPostingAllowed: true },
};

function version(n: number, accountId: string, from: string, to: string | null = null, name = 'Cement') {
  return {
    id: `v${n}`, postingProfileId: 'p1', versionNumber: n, name, description: null, accountId,
    effectiveFrom: d(from), effectiveTo: to ? d(to) : null, changedBy: 'seed', approvedBy: null, approvedAt: null,
    createdAt: d(from),
  };
}

function build(profile: Record<string, unknown> | null = null) {
  const tx = { marker: 'tx' };
  const prisma = { $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const stored = profile ?? {
    id: 'p1', organizationId: 'org1', code: 'COST_51100', status: 'ACTIVE', createdAt: d('2026-01-01'), createdBy: 'seed',
    versions: [version(1, 'a51100', '2026-01-01')],
  };
  const repo = {
    findAll: jest.fn(async () => [stored]),
    findById: jest.fn(async () => stored),
    findByCode: jest.fn(async (_p: unknown, _o: string, code: string) => (code === 'COST_51100' ? stored : null)),
    findAccountByCode: jest.fn(async (_p: unknown, _o: string, code: string) => ACCOUNTS[code] ?? null),
    findAccountLabels: jest.fn(async () => new Map(Object.values(ACCOUNTS).map((a) => [a.id, { code: a.code, name: a.name, accountClass: a.accountClass }]))),
    create: jest.fn(async () => ({ id: 'p2' })),
    addVersion: jest.fn(async () => undefined),
    setStatus: jest.fn(async () => undefined),
    lockAndLatestVersionNumber: jest.fn(async (): Promise<number | null> => 1),
    countUnpostedBillsUsing: jest.fn(async () => 0),
    recordAudit: jest.fn(async () => undefined),
  };
  const service = new PostingProfileService({ getClient: () => prisma } as never, repo as never);
  return { service, repo, tx, stored };
}

describe('PostingProfileService.create', () => {
  it('creates the profile and its first version against a valid cost account, audited, in one transaction', async () => {
    const { service, repo, tx } = build();
    await service.create(identity, { code: 'COST_51200', name: 'Steel', accountCode: '51200', effectiveFrom: '2026-01-01' });
    expect(repo.create).toHaveBeenCalledWith(tx, expect.objectContaining({
      organizationId: 'org1', code: 'COST_51200', name: 'Steel', accountId: 'a51200', effectiveFrom: d('2026-01-01'), createdBy: 'u1',
    }));
    expect(repo.recordAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'POSTING_PROFILE_CREATED' }));
  });

  it('409 POSTING_PROFILE_CODE_TAKEN for an existing code', async () => {
    const { service, repo } = build();
    await expect(service.create(identity, { code: 'COST_51100', name: 'x', accountCode: '51100' }))
      .rejects.toMatchObject({ response: { errorCode: 'POSTING_PROFILE_CODE_TAKEN' } });
    await expect(service.create(identity, { code: 'COST_51100', name: 'x', accountCode: '51100' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing account', '99999'],
    ['a heading', '51000'],
    ['a control account', '11000'],
    ['a balance-sheet account', '21100'],
    ['an inactive account', '61900'],
  ])('400 POSTING_PROFILE_ACCOUNT_INVALID for %s', async (_label, accountCode) => {
    const { service, repo } = build();
    await expect(service.create(identity, { code: 'NEW_ONE', name: 'x', accountCode }))
      .rejects.toMatchObject({ response: { errorCode: 'POSTING_PROFILE_ACCOUNT_INVALID' } });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a code outside A–Z0–9_', async () => {
    const { service } = build();
    await expect(service.create(identity, { code: 'cost-1', name: 'x', accountCode: '51100' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PostingProfileService.repoint', () => {
  it('supersedes the latest version from the new date (the previous one is closed there)', async () => {
    const { service, repo, tx, stored } = build();
    await service.repoint(identity, 'p1', { accountCode: '51200', effectiveFrom: '2026-10-01' });
    const latest = (stored.versions as unknown[])[0];
    expect(repo.addVersion).toHaveBeenCalledWith(tx, latest, {
      name: 'Cement', accountId: 'a51200', effectiveFrom: d('2026-10-01'), changedBy: 'u1',
    });
    expect(repo.recordAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'POSTING_PROFILE_REPOINTED' }));
  });

  it('400 when the new version does not start after the current one', async () => {
    const { service, repo } = build();
    for (const effectiveFrom of ['2026-01-01', '2025-12-31']) {
      await expect(service.repoint(identity, 'p1', { accountCode: '51200', effectiveFrom }))
        .rejects.toMatchObject({ response: { errorCode: 'POSTING_PROFILE_VERSION_INVALID' } });
    }
    expect(repo.addVersion).not.toHaveBeenCalled();
  });

  it('400 when nothing changes (same account, same name)', async () => {
    const { service } = build();
    await expect(service.repoint(identity, 'p1', { accountCode: '51100', effectiveFrom: '2026-06-01' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 when re-pointing to an invalid account; 404 for an unknown profile', async () => {
    const { service, repo } = build();
    await expect(service.repoint(identity, 'p1', { accountCode: '11000', effectiveFrom: '2026-06-01' }))
      .rejects.toMatchObject({ response: { errorCode: 'POSTING_PROFILE_ACCOUNT_INVALID' } });
    repo.findById.mockResolvedValueOnce(null as never);
    await expect(service.repoint(identity, 'nope', { accountCode: '51200', effectiveFrom: '2026-06-01' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PostingProfileService.repoint — review fixes', () => {
  it('M1: a cost profile may move to another cost or expense account, never to income', async () => {
    const { service, repo } = build();
    await expect(service.repoint(identity, 'p1', { accountCode: '42100', effectiveFrom: '2026-06-01' }))
      .rejects.toMatchObject({ response: { errorCode: 'POSTING_PROFILE_CLASS_CHANGE' } });
    await service.repoint(identity, 'p1', { accountCode: '61100', effectiveFrom: '2026-06-01' }); // COST → EXPENSE ok
    expect(repo.addVersion).toHaveBeenCalledTimes(1);
  });

  it('M1: an income profile may only move to another income account', async () => {
    const { service, repo } = build({
      id: 'p1', organizationId: 'org1', code: 'INC_42100', status: 'ACTIVE', createdAt: d('2026-01-01'), createdBy: 's',
      versions: [version(1, 'a42100', '2026-01-01', null, 'Hire')],
    });
    await expect(service.repoint(identity, 'p1', { accountCode: '51200', effectiveFrom: '2026-06-01' }))
      .rejects.toMatchObject({ response: { errorCode: 'POSTING_PROFILE_CLASS_CHANGE' } });
    await service.repoint(identity, 'p1', { accountCode: '42200', effectiveFrom: '2026-06-01' });
    expect(repo.addVersion).toHaveBeenCalledTimes(1);
  });

  it('L1: a concurrent re-point that got there first → 409 POSTING_PROFILE_CHANGED, nothing written', async () => {
    const { service, repo } = build();
    repo.lockAndLatestVersionNumber.mockResolvedValueOnce(2);
    await expect(service.repoint(identity, 'p1', { accountCode: '51200', effectiveFrom: '2026-06-01' }))
      .rejects.toMatchObject({ status: 409, response: { errorCode: 'POSTING_PROFILE_CHANGED' } });
    expect(repo.addVersion).not.toHaveBeenCalled();
  });

  it('L1: a unique violation on the version number is also a 409, not a 500', async () => {
    const { service, repo } = build();
    repo.addVersion.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(service.repoint(identity, 'p1', { accountCode: '51200', effectiveFrom: '2026-06-01' }))
      .rejects.toMatchObject({ response: { errorCode: 'POSTING_PROFILE_CHANGED' } });
  });
});

describe('PostingProfileService.setActive / list', () => {
  it('L2: deactivating a profile named by unposted bills → 409 POSTING_PROFILE_IN_USE with the count', async () => {
    const { service, repo } = build();
    repo.countUnpostedBillsUsing.mockResolvedValueOnce(3);
    await expect(service.setActive(identity, 'p1', false)).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'POSTING_PROFILE_IN_USE', details: { unpostedBills: 3 } },
    });
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it('deactivates (audited) and is idempotent when already in the target state', async () => {
    const { service, repo, tx } = build();
    await service.setActive(identity, 'p1', false);
    expect(repo.setStatus).toHaveBeenCalledWith(tx, 'p1', 'INACTIVE');
    expect(repo.recordAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'POSTING_PROFILE_DEACTIVATED' }));

    repo.setStatus.mockClear();
    await service.setActive(identity, 'p1', true); // stored is ACTIVE → no-op
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it('lists every version with its account label and the account in force today', async () => {
    const profile = {
      id: 'p1', organizationId: 'org1', code: 'COST_51100', status: 'ACTIVE', createdAt: d('2020-01-01'), createdBy: 'seed',
      versions: [version(2, 'a51200', '2021-01-01', null, 'Steel'), version(1, 'a51100', '2020-01-01', '2021-01-01')],
    };
    const { service } = build(profile);
    const [view] = await service.list(identity);
    expect(view!.versions.map((v) => [v.versionNumber, v.accountCode, v.accountName])).toEqual([
      [2, '51200', 'Steel and reinforcement'],
      [1, '51100', 'Cement and concrete'],
    ]);
    expect(view!.currentAccount).toEqual({ id: 'a51200', code: '51200', name: 'Steel and reinforcement', accountClass: 'COST_OF_SALES' });
  });

  it('a profile whose only version starts in the future has no current account yet', async () => {
    const { service } = build({
      id: 'p1', organizationId: 'org1', code: 'X', status: 'ACTIVE', createdAt: d('2026-01-01'), createdBy: 'u',
      versions: [version(1, 'a51100', '2999-01-01')],
    });
    const [view] = await service.list(identity);
    expect(view!.currentAccount).toBeNull();
  });
});

describe('toDateOnly', () => {
  it('keeps the calendar day of an ISO date or date-time', () => {
    expect(toDateOnly('2026-10-01').toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(toDateOnly('2026-10-01T23:30:00+03:00').toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});
