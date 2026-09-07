/**
 * AR — Accounting readiness.
 *
 * The read model behind "Unavailable" rather than "$0.00". A project with no posted cost
 * because nobody finished the chart of accounts has not spent nothing, and the difference is
 * only presentable if the backend can say precisely what is missing.
 *
 * Pure unit tests: prisma is mocked, because what is under test is which conditions count as
 * blockers — not how they are queried.
 */
import { AccountingReadinessService } from './accounting-readiness.service.js';

const identity = { activeOrganizationId: 'o1', userId: 'u1' } as never;

/** Every control-account role the posting paths resolve, filled exactly once. */
const COMPLETE_ROLES = [
  'ACCOUNTS_RECEIVABLE',
  'ACCOUNTS_PAYABLE',
  'PROJECT_REVENUE',
  'VAT_OUTPUT_PAYABLE',
  'CASH_AND_BANK',
  'UNAPPLIED_CLIENT_RECEIPTS',
  'SUPPLIER_ADVANCE',
];

function build(over: {
  subtypes?: string[];
  openPeriods?: number;
  futurePeriods?: number;
  profiles?: number;
  sequences?: string[];
} = {}) {
  const subtypes = over.subtypes ?? COMPLETE_ROLES;
  const prisma = {
    account: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          subtypes.map((accountSubtype, i) => ({ id: `a${i}`, versions: [{ accountSubtype }] })),
        ),
    },
    accountingPeriod: {
      count: jest
        .fn()
        // First call is the open-period check, second is the calendar-reach check.
        .mockResolvedValueOnce(over.openPeriods ?? 1)
        .mockResolvedValueOnce(over.futurePeriods ?? 12),
    },
    postingProfile: { count: jest.fn().mockResolvedValue(over.profiles ?? 4) },
    documentNumberSequence: {
      findMany: jest.fn().mockResolvedValue(
        (over.sequences ?? ['JOURNAL_ENTRY', 'CLIENT_INVOICE', 'SUPPLIER_BILL']).map(
          (documentType) => ({ documentType }),
        ),
      ),
    },
  };
  const tenancy = { getClient: () => prisma } as never;
  return new AccountingReadinessService(tenancy);
}

const codes = (r: { blockers: Array<{ code: string }> }) => r.blockers.map((b) => b.code);

it('AR-01: a fully configured organisation is ready, with no blockers', async () => {
  const result = await build().getReadiness(identity);

  expect(result.ready).toBe(true);
  expect(result.blockers).toHaveLength(0);
});

it('AR-02: an empty chart of accounts is a single clear blocker, not seven', async () => {
  const result = await build({ subtypes: [] }).getReadiness(identity);

  expect(result.ready).toBe(false);
  // "No chart of accounts" once, rather than one missing-role blocker per role — the fix is
  // one action, and listing seven symptoms of it hides that.
  expect(codes(result)).toEqual(['NO_CHART_OF_ACCOUNTS']);
});

it('AR-03: a missing control-account role names the role that is missing', async () => {
  const withoutRevenue = COMPLETE_ROLES.filter((s) => s !== 'PROJECT_REVENUE');
  const result = await build({ subtypes: withoutRevenue }).getReadiness(identity);

  expect(result.ready).toBe(false);
  expect(codes(result)).toContain('POSTING_ACCOUNT_NOT_CONFIGURED');
  expect(result.blockers[0]!.label).toBe('Project revenue');
});

/**
 * Two accounts marked the same control role is a contradictory chart, and the posting
 * resolver refuses to guess between them. Reporting it as "not configured" would send an
 * administrator to add a third.
 */
it('AR-04: an ambiguous control role is reported as ambiguous, not as missing', async () => {
  const result = await build({
    subtypes: [...COMPLETE_ROLES, 'ACCOUNTS_RECEIVABLE'],
  }).getReadiness(identity);

  expect(codes(result)).toEqual(['POSTING_ACCOUNT_AMBIGUOUS']);
});

/** Bank is the one legitimately plural role — an organisation with five banks has five. */
it('AR-05: several bank accounts are not an ambiguity', async () => {
  const result = await build({
    subtypes: [...COMPLETE_ROLES, 'CASH_AND_BANK', 'CASH_AND_BANK'],
  }).getReadiness(identity);

  expect(result.ready).toBe(true);
});

it('AR-06: no open period blocks posting', async () => {
  const result = await build({ openPeriods: 0 }).getReadiness(identity);

  expect(codes(result)).toContain('NO_OPEN_PERIOD');
  expect(result.blockers.find((b) => b.code === 'NO_OPEN_PERIOD')!.detail).toMatch(/OPEN or REOPENED/);
});

/**
 * A fiscal calendar that has run out fails at post time with "no accounting period covers
 * this date", which reads as a data problem rather than "open next year".
 */
it('AR-07: a calendar that does not reach today says so specifically', async () => {
  const result = await build({ openPeriods: 0, futurePeriods: 0 }).getReadiness(identity);

  expect(result.blockers.find((b) => b.code === 'NO_OPEN_PERIOD')!.detail).toMatch(
    /does not reach today/,
  );
});

it('AR-08: no posting profile blocks supplier bills', async () => {
  const result = await build({ profiles: 0 }).getReadiness(identity);

  expect(codes(result)).toContain('NO_POSTING_PROFILES');
});

it('AR-09: a missing document sequence is reported per document type', async () => {
  const result = await build({ sequences: ['JOURNAL_ENTRY'] }).getReadiness(identity);

  const missing = result.blockers.filter((b) => b.code === 'NO_DOCUMENT_SEQUENCE');
  expect(missing).toHaveLength(2);
  expect(missing.map((b) => b.label).join(' ')).toMatch(/client invoice.*supplier bill/i);
});
