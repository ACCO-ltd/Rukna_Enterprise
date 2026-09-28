/**
 * RT — AR project-tag reclassification (owner decision 2026-09-28, option C), live DB.
 *
 * Seeds exactly the historical defect: an invoice reversal (EVT-AR-002) and a credit note
 * (EVT-AR-007) whose revenue lines were posted WITHOUT the invoice's project. Then proves the
 * audit → approval → apply cycle end to end, through the same runner the script uses:
 *
 *   RT-01  no affected lines → the audit finds nothing (nothing would be posted)
 *   RT-02  the audit itemises each untagged line with its source, intended project and effect
 *   RT-03  a report that no longer matches the ledger is refused and nothing is posted
 *   RT-04  apply posts balanced, linked corrections; trial balance unchanged; project revenue
 *          moves by the expected amount; the Billing–GL gap clears
 *   RT-05  re-running is a no-op: corrected lines drop out of the audit, a repeat apply is refused
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { AccountingFixtureFactory, AccountingTestEnv } from './helpers/fixture.factory';
import { buildServices, AccountingServices } from './helpers/build-services';
import {
  accountNets,
  applyRetag,
  auditRetag,
  billingGap,
  revenueByProject,
} from '../accounts-receivable/application/ar-project-retag.runner';
import {
  RETAG_SOURCE_TYPE,
  retagFingerprint,
  retagStatus,
} from '../accounts-receivable/domain/ar-project-retag.policy';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let projectId: string;
let invoiceA: string;
let invoiceB: string;
let creditNoteId: string;

async function post(
  sourceDocumentType: 'CLIENT_INVOICE' | 'CREDIT_NOTE',
  sourceDocumentId: string,
  eventType: string,
  lines: Array<{ accountId: string; debit: string; credit: string; projectId?: string }>,
  extra: { reversalOfJournalEntryId?: string; entryPurpose?: 'NORMAL' | 'REVERSAL' } = {},
) {
  return prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate: env.periods.openStart,
        documentDate: env.periods.openStart,
        description: `RT seed ${eventType} ${sourceDocumentId}`,
        currencyCode: 'USD',
        eventType,
        sourceDocumentType,
        sourceDocumentId,
        journalCategory: 'ACCOUNTS_RECEIVABLE',
        entryPurpose: extra.entryPurpose ?? 'NORMAL',
        postingOrigin: 'SYSTEM_AR',
        createdBy: env.identity.userId,
        ...(extra.reversalOfJournalEntryId ? { reversalOfJournalEntryId: extra.reversalOfJournalEntryId } : {}),
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debitAmount: new Decimal(l.debit),
          creditAmount: new Decimal(l.credit),
          ...(l.projectId ? { projectId: l.projectId } : {}),
        })),
      },
      tx as never,
    ),
  );
}

async function invoice(total: string, postingStatus: 'POSTED' | 'REVERSED'): Promise<string> {
  const row = await prisma.clientInvoice.create({
    data: {
      organizationId: env.orgId,
      clientId: env.clientId,
      projectId,
      invoiceDate: env.periods.openStart,
      dueDate: env.periods.openEnd,
      subtotal: new Decimal(total),
      vatAmount: new Decimal(0),
      totalAmount: new Decimal(total),
      outstandingAmount: new Decimal(postingStatus === 'POSTED' ? total : '0'),
      currencyCode: 'USD',
      billingAddressSnapshot: {},
      documentStatus: 'APPROVED',
      postingStatus,
      createdBy: env.identity.userId,
    },
  });
  return row.id;
}

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  projectId = (await prisma.project.findFirstOrThrow({ where: { organizationId: env.orgId } })).id;
});

afterAll(async () => {
  await prisma.creditNote.deleteMany({ where: { organizationId: env.orgId } });
  await prisma.clientInvoice.updateMany({
    where: { organizationId: env.orgId },
    data: { postedJournalEntryId: null },
  });
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('RT-01: finds nothing when no reversal or credit note lacks its project', async () => {
  expect(await auditRetag(prisma, env.orgId)).toEqual([]);
});

describe('with the historical defect seeded', () => {
  beforeAll(async () => {
    const { arId, revId } = env.accounts;

    // Invoice A: 1,000 revenue on the project, then reversed — the reversal dropped the project.
    invoiceA = await invoice('1000', 'REVERSED');
    const originalA = await post('CLIENT_INVOICE', invoiceA, 'EVT-AR-001', [
      { accountId: arId, debit: '1000', credit: '0' },
      { accountId: revId, debit: '0', credit: '1000', projectId },
    ]);
    await prisma.clientInvoice.update({ where: { id: invoiceA }, data: { postedJournalEntryId: originalA.journalEntryId } });
    await post(
      'CLIENT_INVOICE',
      `reversal-${invoiceA}`,
      'EVT-AR-002',
      [
        { accountId: arId, debit: '0', credit: '1000' },
        { accountId: revId, debit: '1000', credit: '0' }, // ← untagged
      ],
      { reversalOfJournalEntryId: originalA.journalEntryId, entryPurpose: 'REVERSAL' },
    );

    // Invoice B: 500 on the project, credited 200 — the credit note's revenue debit dropped the project.
    invoiceB = await invoice('500', 'POSTED');
    const originalB = await post('CLIENT_INVOICE', invoiceB, 'EVT-AR-001', [
      { accountId: arId, debit: '500', credit: '0' },
      { accountId: revId, debit: '0', credit: '500', projectId },
    ]);
    await prisma.clientInvoice.update({ where: { id: invoiceB }, data: { postedJournalEntryId: originalB.journalEntryId } });
    creditNoteId = (
      await prisma.creditNote.create({
        data: {
          organizationId: env.orgId,
          invoiceId: invoiceB,
          creditNoteNumber: `CN-RT-${env.orgId.slice(-6)}`,
          reason: 'PRICE_ERROR',
          netAmount: new Decimal('200'),
          vatAmount: new Decimal('0'),
          totalAmount: new Decimal('200'),
          accountingDate: env.periods.openStart,
          postingStatus: 'POSTED',
          createdBy: env.identity.userId,
        },
      })
    ).id;
    await post(
      'CREDIT_NOTE',
      creditNoteId,
      'EVT-AR-007',
      [
        { accountId: revId, debit: '200', credit: '0' }, // ← untagged
        { accountId: arId, debit: '0', credit: '200' },
      ],
      { entryPurpose: 'REVERSAL' },
    );
  });

  it('RT-02: itemises each untagged line with its source, intended project and effect', async () => {
    const lines = await auditRetag(prisma, env.orgId);
    expect(lines).toHaveLength(2);
    const reversal = lines.find((l) => l.sourceKind === 'INVOICE_REVERSAL')!;
    const credit = lines.find((l) => l.sourceKind === 'CREDIT_NOTE')!;
    expect(reversal).toMatchObject({ sourceInvoiceId: invoiceA, intendedProjectId: projectId, accountId: env.accounts.revId });
    expect(new Decimal(reversal.debit).toFixed(2)).toBe('1000.00');
    expect(credit).toMatchObject({ sourceInvoiceId: invoiceB, creditNoteId, intendedProjectId: projectId });
    expect(new Decimal(credit.debit).toFixed(2)).toBe('200.00');
    expect(lines.every((l) => retagStatus(l) === 'READY')).toBe(true);

    // The project shows 1,500 of revenue; billed net is 300 (B less its credit) — gap −1,200.
    expect((await revenueByProject(prisma, env.orgId)).get(projectId)!.toFixed(2)).toBe('1500.00');
    expect((await billingGap(prisma, env.orgId, projectId)).toFixed(2)).toBe('-1200.00');
  });

  it('RT-03: refuses a report that no longer matches the ledger, posting nothing', async () => {
    const lines = await auditRetag(prisma, env.orgId);
    const tampered = lines.map((l) => (l.sourceKind === 'CREDIT_NOTE' ? { ...l, debit: '150.00' } : l));
    await expect(
      applyRetag(prisma, svc.postingService, {
        orgId: env.orgId,
        approved: { organizationId: env.orgId, fingerprint: retagFingerprint(tampered), ready: tampered },
        approvedBy: env.identity.userId,
        actor: env.identity.userId,
      }),
    ).rejects.toThrow(/no longer matches the approved report/);
    expect(await prisma.journalEntry.count({ where: { organizationId: env.orgId, sourceDocumentType: RETAG_SOURCE_TYPE } })).toBe(0);
  });

  it('RT-04: posts balanced, linked corrections; trial balance unchanged; the Billing–GL gap clears', async () => {
    const netsBefore = await accountNets(prisma, env.orgId);
    const lines = await auditRetag(prisma, env.orgId);
    const summary = await applyRetag(prisma, svc.postingService, {
      orgId: env.orgId,
      approved: { organizationId: env.orgId, fingerprint: retagFingerprint(lines), ready: lines },
      approvedBy: env.identity.userId,
      actor: env.identity.userId,
    });
    expect(summary.posted).toHaveLength(2);

    // Company: every account's net is unchanged.
    const netsAfter = await accountNets(prisma, env.orgId);
    for (const [account, net] of netsBefore) expect(netsAfter.get(account)!.equals(net)).toBe(true);

    // Project: revenue now 300 (1,500 − 1,000 − 200) and matches what was billed.
    expect((await revenueByProject(prisma, env.orgId)).get(projectId)!.toFixed(2)).toBe('300.00');
    expect((await billingGap(prisma, env.orgId, projectId)).toFixed(2)).toBe('0.00');

    // Each correction: balanced, same account, linked to the line it corrects, reason recorded.
    const corrections = await prisma.journalEntry.findMany({
      where: { organizationId: env.orgId, sourceDocumentType: RETAG_SOURCE_TYPE },
      include: { lines: true },
    });
    expect(corrections).toHaveLength(2);
    for (const c of corrections) {
      const debit = c.lines.reduce((s, l) => s.plus(l.debitAmount.toString()), new Decimal(0));
      const credit = c.lines.reduce((s, l) => s.plus(l.creditAmount.toString()), new Decimal(0));
      expect(debit.equals(credit)).toBe(true);
      expect(new Set(c.lines.map((l) => l.accountId))).toEqual(new Set([env.accounts.revId]));
      expect(c.sourceDocumentId).toMatch(/^ar-project-retag:/);
      expect(c.description).toMatch(/was posted without project/);
      expect(c.lines.map((l) => l.projectId).sort()).toEqual([null, projectId].sort());
    }

    // The originals are untouched.
    const originals = await prisma.journalLine.count({
      where: { entry: { organizationId: env.orgId, accountingEventId: { in: ['EVT-AR-002', 'EVT-AR-007'] } }, accountId: env.accounts.revId, projectId: null },
    });
    expect(originals).toBe(2);
  });

  it('RT-05: a re-run is a no-op — corrected lines drop out and a repeat apply is refused', async () => {
    const lines = await auditRetag(prisma, env.orgId);
    expect(lines.every((l) => retagStatus(l) === 'ALREADY_CORRECTED')).toBe(true);
    const stale = lines.map((l) => ({ ...l, alreadyCorrected: false }));
    await expect(
      applyRetag(prisma, svc.postingService, {
        orgId: env.orgId,
        approved: { organizationId: env.orgId, fingerprint: retagFingerprint(stale), ready: stale },
        approvedBy: env.identity.userId,
        actor: env.identity.userId,
      }),
    ).rejects.toThrow(/no longer matches/);
    expect(await prisma.journalEntry.count({ where: { organizationId: env.orgId, sourceDocumentType: RETAG_SOURCE_TYPE } })).toBe(2);
  });
});
