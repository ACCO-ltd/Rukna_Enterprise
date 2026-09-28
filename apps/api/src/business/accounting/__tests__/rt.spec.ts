/**
 * RT — AR project-tag reclassification (owner decision 2026-09-28, option C), live DB.
 *
 * Seeds exactly the historical defect — an invoice reversal (EVT-AR-002) and a credit note
 * (EVT-AR-007) whose revenue lines were posted WITHOUT the invoice's project — plus a reversal in a
 * CLOSED period and an unaffected second project. Then proves the audit → approval → apply cycle
 * through the same runner the script uses:
 *
 *   RT-01  no affected lines → the audit finds nothing (nothing would be posted)
 *   RT-02  the audit itemises each line: source, intended project, amount, account, period, effect
 *   RT-03  approval is enforced: approver ≠ actor, and must hold manage:journal
 *   RT-04  a report that no longer matches the ledger is refused; nothing posted
 *   RT-05  a proof failure (correction to the wrong project) rolls everything back
 *   RT-06  an empty approved report posts nothing
 *   RT-07  apply: balanced, linked, audited corrections; trial balance and company revenue
 *          unchanged; the project moves by exactly the expected amount; the unaffected project
 *          does not; the Billing–GL gap moves by exactly the corrected amount; the closed-period
 *          line is never posted; originals untouched; period snapshots marked INVALID
 *   RT-08  re-running is a no-op; a correction later reversed makes its line reappear and the
 *          re-correction gets its own versioned key
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
  type RetagLine,
} from '../accounts-receivable/domain/ar-project-retag.policy';
import type { IAccountingPostingPort } from '../accounting-core/application/ports/accounting-posting.port';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let projectP: string;
let projectQ: string;
let invoiceA: string;
let invoiceB: string;
let creditNoteId: string;
let actorId: string;
let approverId: string;
let bystanderId: string;

async function post(
  sourceDocumentType: 'CLIENT_INVOICE' | 'CREDIT_NOTE' | 'MANUAL_JOURNAL',
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
        journalCategory: sourceDocumentType === 'MANUAL_JOURNAL' ? 'GENERAL' : 'ACCOUNTS_RECEIVABLE',
        entryPurpose: extra.entryPurpose ?? 'NORMAL',
        postingOrigin: sourceDocumentType === 'MANUAL_JOURNAL' ? 'MANUAL' : 'SYSTEM_AR',
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

async function invoice(project: string, total: string, postingStatus: 'POSTED' | 'REVERSED'): Promise<string> {
  const row = await prisma.clientInvoice.create({
    data: {
      organizationId: env.orgId,
      clientId: env.clientId,
      projectId: project,
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

/** An invoice posted with revenue on `project`, then reversed with the project dropped. */
async function reversedInvoice(project: string, total: string): Promise<{ invoiceId: string; reversalId: string }> {
  const { arId, revId } = env.accounts;
  const invoiceId = await invoice(project, total, 'REVERSED');
  const original = await post('CLIENT_INVOICE', invoiceId, 'EVT-AR-001', [
    { accountId: arId, debit: total, credit: '0' },
    { accountId: revId, debit: '0', credit: total, projectId: project },
  ]);
  await prisma.clientInvoice.update({ where: { id: invoiceId }, data: { postedJournalEntryId: original.journalEntryId } });
  const reversal = await post(
    'CLIENT_INVOICE',
    `reversal-${invoiceId}`,
    'EVT-AR-002',
    [
      { accountId: arId, debit: '0', credit: total },
      { accountId: revId, debit: total, credit: '0' }, // ← untagged: the historical defect
    ],
    { reversalOfJournalEntryId: original.journalEntryId, entryPurpose: 'REVERSAL' },
  );
  return { invoiceId, reversalId: reversal.journalEntryId };
}

function report(lines: RetagLine[]) {
  return { organizationId: env.orgId, fingerprint: retagFingerprint(lines), ready: lines };
}

async function readyLines(): Promise<RetagLine[]> {
  return (await auditRetag(prisma, env.orgId)).filter((l) => retagStatus(l) === 'READY');
}

async function retagJournalCount(): Promise<number> {
  return prisma.journalEntry.count({ where: { organizationId: env.orgId, sourceDocumentType: RETAG_SOURCE_TYPE } });
}

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  projectP = (await prisma.project.findFirstOrThrow({ where: { organizationId: env.orgId } })).id;
  projectQ = (
    await prisma.project.create({
      data: {
        organizationId: env.orgId,
        code: `PRJ-Q-${env.orgId.slice(-5)}`,
        name: 'Unaffected project',
        status: 'ACTIVE',
        commercialModel: 'CLIENT_CONTRACT',
        participationModel: 'SOLE',
        createdBy: env.identity.userId,
      },
    })
  ).id;

  // People: the actor, an approver with manage:journal, and a bystander without it.
  const suffix = env.orgId.slice(-8);
  const user = (name: string) =>
    prisma.user.create({
      data: {
        email: `${name}-${suffix}@rt.test`,
        passwordHash: 'x',
        firstName: name,
        lastName: 'RT',
        organizationId: env.orgId,
      },
    });
  actorId = (await user('actor')).id;
  approverId = (await user('approver')).id;
  bystanderId = (await user('bystander')).id;
  const permission = await prisma.permission.upsert({
    where: { action_resource: { action: 'manage', resource: 'journal' } },
    update: {},
    create: { action: 'manage', resource: 'journal' },
  });
  const role = await prisma.role.create({ data: { name: 'RT accountant', organizationId: env.orgId } });
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  await prisma.userRole.create({ data: { userId: approverId, roleId: role.id } });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { orgId: env.orgId } });
  await prisma.userRole.deleteMany({ where: { user: { organizationId: env.orgId } } });
  await prisma.rolePermission.deleteMany({ where: { role: { organizationId: env.orgId } } });
  await prisma.role.deleteMany({ where: { organizationId: env.orgId } });
  await prisma.user.deleteMany({ where: { organizationId: env.orgId } });
  await prisma.creditNote.deleteMany({ where: { organizationId: env.orgId } });
  await prisma.clientInvoice.updateMany({ where: { organizationId: env.orgId }, data: { postedJournalEntryId: null } });
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('RT-01: finds nothing when no reversal or credit note lacks its project', async () => {
  expect(await auditRetag(prisma, env.orgId)).toEqual([]);
});

describe('with the historical defect seeded', () => {
  let originalAmounts: Array<{ id: string; debit: string; credit: string; projectId: string | null }>;

  beforeAll(async () => {
    const { arId, revId } = env.accounts;

    // A: 1,000 on P, reversed — reversal untagged.
    invoiceA = (await reversedInvoice(projectP, '1000')).invoiceId;

    // B: 500 on P, credited 200 — the credit note's revenue debit untagged.
    invoiceB = await invoice(projectP, '500', 'POSTED');
    const originalB = await post('CLIENT_INVOICE', invoiceB, 'EVT-AR-001', [
      { accountId: arId, debit: '500', credit: '0' },
      { accountId: revId, debit: '0', credit: '500', projectId: projectP },
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

    // C: 400 on P, reversed — but its reversal sits in a CLOSED period.
    const c = await reversedInvoice(projectP, '400');
    await prisma.journalEntry.update({
      where: { id: c.reversalId },
      data: { accountingPeriodId: env.periods.closedId, accountingDate: env.periods.closedStart },
    });

    // D: 250 on Q — correctly tagged, never reversed. Q must not move.
    const invoiceD = await invoice(projectQ, '250', 'POSTED');
    await post('CLIENT_INVOICE', invoiceD, 'EVT-AR-001', [
      { accountId: arId, debit: '250', credit: '0' },
      { accountId: revId, debit: '0', credit: '250', projectId: projectQ },
    ]);

    // A valid snapshot for the open period — the corrections will make it stale.
    await prisma.periodAccountBalance.create({
      data: {
        organizationId: env.orgId,
        fiscalYearId: env.fiscalYearId,
        accountingPeriodId: env.periods.openId,
        accountId: revId,
        generatedAt: new Date(),
        generatedBy: 'rt',
        status: 'VALID',
      },
    });

    originalAmounts = (
      await prisma.journalLine.findMany({
        where: { entry: { organizationId: env.orgId, accountingEventId: { in: ['EVT-AR-002', 'EVT-AR-007'] } } },
        select: { id: true, debitAmount: true, creditAmount: true, projectId: true },
        orderBy: { id: 'asc' },
      })
    ).map((l) => ({ id: l.id, debit: l.debitAmount.toString(), credit: l.creditAmount.toString(), projectId: l.projectId }));
  });

  it('RT-02: itemises each untagged line with its source, intended project, period and effect', async () => {
    const lines = await auditRetag(prisma, env.orgId);
    expect(lines).toHaveLength(3);

    const reversal = lines.find((l) => l.sourceInvoiceId === invoiceA)!;
    expect(reversal).toMatchObject({ sourceKind: 'INVOICE_REVERSAL', intendedProjectId: projectP, accountId: env.accounts.revId, periodStatus: 'OPEN' });
    expect(new Decimal(reversal.debit).toFixed(2)).toBe('1000.00');

    const credit = lines.find((l) => l.sourceKind === 'CREDIT_NOTE')!;
    expect(credit).toMatchObject({ sourceInvoiceId: invoiceB, creditNoteId, intendedProjectId: projectP });
    expect(new Decimal(credit.debit).toFixed(2)).toBe('200.00');

    const blocked = lines.find((l) => l.periodStatus === 'CLOSED')!;
    expect(retagStatus(blocked)).toBe('BLOCKED_PERIOD');
    expect(lines.filter((l) => retagStatus(l) === 'READY')).toHaveLength(2);

    // P shows 1,900 of revenue (A + B + C originals); billed net is 300 (B less its credit).
    expect((await revenueByProject(prisma, env.orgId)).get(projectP)!.toFixed(2)).toBe('1900.00');
    expect((await billingGap(prisma, env.orgId, projectP)).toFixed(2)).toBe('-1600.00');
  });

  it('RT-03: enforces the accountant’s approval — a different person, holding manage:journal', async () => {
    const lines = await readyLines();
    await expect(
      applyRetag(prisma, svc.postingService, { orgId: env.orgId, approved: report(lines), approvedBy: actorId, actor: actorId }),
    ).rejects.toThrow(/someone other than the person applying/);
    await expect(
      applyRetag(prisma, svc.postingService, { orgId: env.orgId, approved: report(lines), approvedBy: bystanderId, actor: actorId }),
    ).rejects.toThrow(/journal approval rights/);
    expect(await retagJournalCount()).toBe(0);
  });

  it('RT-04: refuses a report that no longer matches the ledger, posting nothing', async () => {
    const tampered = (await readyLines()).map((l) => (l.sourceKind === 'CREDIT_NOTE' ? { ...l, debit: '150.00' } : l));
    await expect(
      applyRetag(prisma, svc.postingService, { orgId: env.orgId, approved: report(tampered), approvedBy: approverId, actor: actorId }),
    ).rejects.toThrow(/no longer matches the approved report/);
    expect(await retagJournalCount()).toBe(0);
  });

  it('RT-05: a proof failure rolls everything back — here, corrections landing on the wrong project', async () => {
    const wrongProject: IAccountingPostingPort = {
      post: (command, tx) =>
        svc.postingService.post(
          { ...command, lines: command.lines.map((l) => (l.projectId ? { ...l, projectId: projectQ } : l)) },
          tx,
        ),
    };
    await expect(
      applyRetag(prisma, wrongProject, { orgId: env.orgId, approved: report(await readyLines()), approvedBy: approverId, actor: actorId }),
    ).rejects.toThrow(/Proof failed/);
    expect(await retagJournalCount()).toBe(0);
    expect(await prisma.auditLog.count({ where: { orgId: env.orgId, action: 'AR_PROJECT_RETAG_POSTED' } })).toBe(0);
  });

  it('RT-06: an empty approved report posts nothing', async () => {
    const summary = await applyRetag(prisma, svc.postingService, {
      orgId: env.orgId,
      approved: report([]),
      approvedBy: approverId,
      actor: actorId,
    });
    expect(summary.posted).toEqual([]);
    expect(await retagJournalCount()).toBe(0);
  });

  it('RT-07: applies balanced, linked, audited corrections with every proof holding', async () => {
    const netsBefore = await accountNets(prisma, env.orgId);
    const revenueBefore = await revenueByProject(prisma, env.orgId);
    const companyRevenueBefore = [...revenueBefore.values()].reduce((s, v) => s.plus(v), new Decimal(0));

    const summary = await applyRetag(prisma, svc.postingService, {
      orgId: env.orgId,
      approved: report(await readyLines()),
      approvedBy: approverId,
      actor: actorId,
    });
    expect(summary.posted).toHaveLength(2);

    // Company: every account's net and total revenue unchanged.
    const netsAfter = await accountNets(prisma, env.orgId);
    for (const [account, net] of netsBefore) expect(netsAfter.get(account)!.equals(net)).toBe(true);
    const revenueAfter = await revenueByProject(prisma, env.orgId);
    const companyRevenueAfter = [...revenueAfter.values()].reduce((s, v) => s.plus(v), new Decimal(0));
    expect(companyRevenueAfter.equals(companyRevenueBefore)).toBe(true);

    // P moved by exactly −1,200 (1,900 → 700); Q did not move.
    expect(revenueAfter.get(projectP)!.toFixed(2)).toBe('700.00');
    expect(revenueAfter.get(projectQ)!.equals(revenueBefore.get(projectQ)!)).toBe(true);

    // Billing–GL: P's gap moved by exactly the corrected 1,200 (−1,600 → −400). The −400 left is
    // invoice C's reversal, still BLOCKED in its closed period — reported, not hidden.
    expect(summary.gaps).toHaveLength(1);
    expect(summary.gaps[0]!.before.toFixed(2)).toBe('-1600.00');
    expect(summary.gaps[0]!.after.toFixed(2)).toBe('-400.00');
    expect(summary.gaps[0]!.cleared).toBe(false);

    // Each correction: balanced, same revenue account, linked, reason recorded, audited.
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
      expect(c.approvedBy).toBe(approverId);
      expect(c.lines.map((l) => l.projectId ?? '').sort()).toEqual(['', projectP].sort());
    }
    expect(await prisma.auditLog.count({ where: { orgId: env.orgId, action: 'AR_PROJECT_RETAG_POSTED' } })).toBe(2);

    // The closed-period line was never posted against; the originals are untouched, to the cent.
    const blocked = (await auditRetag(prisma, env.orgId)).find((l) => l.periodStatus === 'CLOSED')!;
    expect(retagStatus(blocked)).toBe('BLOCKED_PERIOD');
    const originalsNow = (
      await prisma.journalLine.findMany({
        where: { entry: { organizationId: env.orgId, accountingEventId: { in: ['EVT-AR-002', 'EVT-AR-007'] } } },
        select: { id: true, debitAmount: true, creditAmount: true, projectId: true },
        orderBy: { id: 'asc' },
      })
    ).map((l) => ({ id: l.id, debit: l.debitAmount.toString(), credit: l.creditAmount.toString(), projectId: l.projectId }));
    expect(originalsNow).toEqual(originalAmounts);

    // The open period's snapshot is now stale.
    expect(summary.stale.length).toBeGreaterThan(0);
    const snapshot = await prisma.periodAccountBalance.findFirstOrThrow({
      where: { organizationId: env.orgId, accountingPeriodId: env.periods.openId },
    });
    expect(snapshot.status).toBe('INVALID');
  });

  it('RT-08: re-running is a no-op; a reversed correction makes its line reappear with a new key', async () => {
    // Nothing READY is left, so the same report is refused and nothing is posted.
    const all = await auditRetag(prisma, env.orgId);
    expect(all.filter((l) => retagStatus(l) === 'ALREADY_CORRECTED')).toHaveLength(2);
    const stale = all.filter((l) => l.sourceInvoiceId === invoiceA).map((l) => ({ ...l, alreadyCorrected: false }));
    await expect(
      applyRetag(prisma, svc.postingService, { orgId: env.orgId, approved: report(stale), approvedBy: approverId, actor: actorId }),
    ).rejects.toThrow(/no longer matches/);
    expect(await retagJournalCount()).toBe(2);

    // Someone reverses A's correction from Manual Journals: the defect is back, and so is the line.
    const lineA = all.find((l) => l.sourceInvoiceId === invoiceA)!;
    const correctionA = await prisma.journalEntry.findFirstOrThrow({
      where: { organizationId: env.orgId, sourceDocumentId: `ar-project-retag:${lineA.lineId}` },
      include: { lines: true },
    });
    await post(
      'MANUAL_JOURNAL',
      `reversal-${correctionA.id}`,
      'MANUAL-REVERSAL',
      correctionA.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.creditAmount.toString(),
        credit: l.debitAmount.toString(),
        ...(l.projectId ? { projectId: l.projectId } : {}),
      })),
      { reversalOfJournalEntryId: correctionA.id, entryPurpose: 'REVERSAL' },
    );

    const again = await readyLines();
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ lineId: lineA.lineId, priorCorrections: 1 });

    const summary = await applyRetag(prisma, svc.postingService, {
      orgId: env.orgId,
      approved: report(again),
      approvedBy: approverId,
      actor: actorId,
    });
    expect(summary.posted).toHaveLength(1);
    expect(
      await prisma.journalEntry.count({
        where: { organizationId: env.orgId, sourceDocumentId: `ar-project-retag:${lineA.lineId}:v2` },
      }),
    ).toBe(1);
    expect((await revenueByProject(prisma, env.orgId)).get(projectP)!.toFixed(2)).toBe('700.00');
  });
});
