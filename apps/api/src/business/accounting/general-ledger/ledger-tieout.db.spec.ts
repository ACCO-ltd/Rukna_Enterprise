/**
 * GL-L — the account ledger and the receivable/payable tie-out read true (live DB).
 *
 *   GL-L-01  the ledger refuses an impossible or backwards range, says which side the account sits
 *            on, and a project filter narrows the opening balance as well as the lines
 *   GL-L-02  the tie-out finds the control accounts itself, keeps the sign (a receivable in credit is
 *            a difference, not a match), and reports no made-up bank rows
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../__tests__/helpers/build-services';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

const post = async (date: string, amount: number, projectId?: string) => {
  const draft = await svc.manualJournalService.create(env.identity, {
    accountingDate: date, description: `Rent ${date}`, currencyCode: 'USD',
    lines: [{ accountId: env.accounts.expId, debitAmount: amount, projectId }, { accountId: env.accounts.revId, creditAmount: amount }],
  });
  await svc.manualJournalService.submit(env.identity, draft.id);
  await svc.manualJournalService.approve(env.identity, { journalId: draft.id, approved: true });
  await svc.manualJournalService.post(env.identity, draft.id);
};
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { response?: { errorCode?: string } }) => e.response?.errorCode);

it('GL-L-01: real dates in order; the side it sits on; a project filter narrows the opening too', async () => {
  const projectId = (await prisma.project.findFirstOrThrow({ where: { organizationId: env.orgId } })).id;
  await post('2025-01-05', 100);
  await post('2025-01-06', 40, projectId);
  await post('2025-01-20', 10, projectId);

  expect(await code(svc.ledgerService.getAccountLedger(env.identity, { accountId: env.accounts.expId, fromDate: '2025-02-31', toDate: '2025-03-31' }))).toBe('DATE_INVALID');
  expect(await code(svc.ledgerService.getAccountLedger(env.identity, { accountId: env.accounts.expId, fromDate: '2025-01-31', toDate: '2025-01-01' }))).toBe('DATE_RANGE_INVALID');

  const whole = await svc.ledgerService.getAccountLedger(env.identity, { accountId: env.accounts.expId, fromDate: '2025-01-10', toDate: '2025-01-31' });
  expect(whole).toMatchObject({ normalBalance: 'DEBIT', openingBalance: '140.00', closingBalance: '150.00' });
  const project = await svc.ledgerService.getAccountLedger(env.identity, { accountId: env.accounts.expId, fromDate: '2025-01-10', toDate: '2025-01-31', projectId });
  expect(project).toMatchObject({ openingBalance: '40.00', closingBalance: '50.00' });
  expect((await svc.ledgerService.getAccountLedger(env.identity, { accountId: env.accounts.revId, fromDate: '2025-01-01', toDate: '2025-01-31' })).normalBalance).toBe('CREDIT');
});

it('GL-L-02: control accounts found from the chart; the sign kept; no bank rows', async () => {
  const before = await svc.reconciliationService.runFullReconciliation(env.identity);
  expect(before.checks.map((c) => c.subledgerType).sort()).toEqual(['AP', 'AR']);
  expect(before.checks.find((c) => c.subledgerType === 'AR')).toMatchObject({ accountId: env.accounts.arId, glBalance: '0.00', reconciled: true, documentCount: 0 });

  // A receivable driven into credit by a system posting (no invoice behind it).
  await prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId, accountingDate: new Date('2025-01-15'), documentDate: new Date('2025-01-15'), description: 'Stray credit',
        currencyCode: 'USD', eventType: 'GLL-02', sourceDocumentType: 'MANUAL_JOURNAL', sourceDocumentId: `gll-${Date.now()}`,
        journalCategory: 'GENERAL', entryPurpose: 'NORMAL', postingOrigin: 'SYSTEM_AR', createdBy: env.identity.userId,
        lines: [
          { accountId: env.accounts.revId, debitAmount: new Decimal(50), creditAmount: new Decimal(0) },
          { accountId: env.accounts.arId, debitAmount: new Decimal(0), creditAmount: new Decimal(50) },
        ],
      } as never,
      tx as never,
    ),
  );
  const after = await svc.reconciliationService.runFullReconciliation(env.identity);
  expect(after.checks.find((c) => c.subledgerType === 'AR')).toMatchObject({ glBalance: '-50.00', variance: '-50.00', reconciled: false });
  expect(after.blocksClose).toBe(true);
});
