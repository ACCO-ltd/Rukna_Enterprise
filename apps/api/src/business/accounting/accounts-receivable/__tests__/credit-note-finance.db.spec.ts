/**
 * AR-1 — credit notes from Finance on any posted invoice (live DB).
 *
 *   CNF-01  a hand-typed invoice (no project) is credited; the credit is split back across the
 *           invoice lines' income accounts in proportion, to the cent, and the balance falls
 *   CNF-02  a credit note is posted only through the invoice it belongs to
 *   CNF-03  reversing restores the balance; the list reads every credit note with its state
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { PostingAccountResolver } from '../../accounting-core/application/posting-account-resolver.service';
import { AccountRepository } from '../../accounting-core/infrastructure/account.repository';
import { CreditNoteService, splitByWeight } from '../application/credit-note.service';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let creditNotes: CreditNoteService;
let invoiceId: string;
let otherInvoiceId: string;
let hireId: string;
let scrapId: string;

async function income(code: string, name: string, accountClass: 'INCOME' | 'LIABILITY' = 'INCOME', subtype = 'OTHER_INCOME') {
  const a = await prisma.account.create({
    data: { id: `${env.orgId}-${code}`, organizationId: env.orgId, code, normalBalance: 'CREDIT', createdBy: env.identity.userId },
  });
  await prisma.accountVersion.create({
    data: { accountId: a.id, versionNumber: 1, name, accountClass, accountSubtype: subtype as never, isPostingAllowed: true, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: new Date('2020-01-01'), changedBy: env.identity.userId },
  });
  return a.id;
}

const day = () => env.periods.openStart.toISOString().slice(0, 10);

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  creditNotes = new CreditNoteService({ getClient: () => prisma } as never, svc.sequenceRepo, new PostingAccountResolver(new AccountRepository()), svc.postingService as never);
  hireId = await income('42100', 'Equipment hire income');
  scrapId = await income('42200', 'Sale of surplus materials');
  const clientId = (await prisma.contract.findFirstOrThrow({ where: { organizationId: env.orgId } })).clientId;
  const raise = async (lines: Array<{ description: string; quantity: string; unitPrice: string; revenueAccountCode: string }>) => {
    const inv = await svc.clientInvoiceService.createManual(env.identity, {
      clientId, invoiceDate: day(), dueDate: day(), currencyCode: 'USD', paymentTerms: 'Due on receipt', lines,
    });
    await svc.clientInvoiceService.issue(env.identity, inv.id);
    return inv.id;
  };
  // 300 of hire and 100 of scrap: a 100.00 credit splits 75.00 / 25.00.
  invoiceId = await raise([
    { description: 'Crane hire', quantity: '1', unitPrice: '300.00', revenueAccountCode: '42100' },
    { description: 'Scrap steel', quantity: '1', unitPrice: '100.00', revenueAccountCode: '42200' },
  ]);
  otherInvoiceId = await raise([{ description: 'Crane hire', quantity: '1', unitPrice: '50.00', revenueAccountCode: '42100' }]);
}, 90_000);

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM credit_notes WHERE organization_id = ${env.orgId}`;
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('CNF-01: a hand-typed invoice is credited back to its own income accounts, in proportion', async () => {
  const invoice = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  expect(invoice.projectId).toBeNull();
  const cn = await creditNotes.createCreditNote(env.identity, { invoiceId, reason: 'PRICE_ERROR', netAmount: '100.00', accountingDate: day() });
  const posted = await creditNotes.postCreditNote(env.identity, { creditNoteId: cn.id, invoiceId });
  expect(posted.creditNoteNumber).toMatch(/^CN-/);

  const lines = await prisma.journalLine.findMany({ where: { journalEntryId: posted.postedJournalEntryId! } });
  const debitOn = (accountId: string) => lines.filter((l) => l.accountId === accountId).reduce((s, l) => s.plus(l.debitAmount), new Decimal(0)).toFixed(2);
  expect(debitOn(hireId)).toBe('75.00');
  expect(debitOn(scrapId)).toBe('25.00');
  const after = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  expect(new Decimal(invoice.outstandingAmount).minus(after.outstandingAmount).toFixed(2)).toBe(cn.totalAmount.toFixed(2));
});

it('CNF-02: a credit note is posted only through the invoice it belongs to', async () => {
  const cn = await creditNotes.createCreditNote(env.identity, { invoiceId, reason: 'CORRECTION', netAmount: '10.00', accountingDate: day() });
  await expect(creditNotes.postCreditNote(env.identity, { creditNoteId: cn.id, invoiceId: otherInvoiceId })).rejects.toMatchObject({ status: 404 });
  await creditNotes.postCreditNote(env.identity, { creditNoteId: cn.id, invoiceId });
});

it('CNF-03: reversing restores the balance; the list reads each credit note and its state', async () => {
  const before = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const [first] = await creditNotes.listForInvoice(env.identity, invoiceId);
  await creditNotes.reverseCreditNote(env.identity, { creditNoteId: first!.id, invoiceId, reversalDate: day(), reason: 'Raised on the wrong price' });
  const after = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  expect(new Decimal(after.outstandingAmount).minus(before.outstandingAmount).toFixed(2)).toBe(first!.totalAmount);
  const list = await creditNotes.listForInvoice(env.identity, invoiceId);
  expect(list.map((c) => c.postingStatus)).toEqual(['REVERSED', 'POSTED']);
  expect(list[0]!.reversalReason).toBe('Raised on the wrong price');
});

it('splitByWeight: parts always add up, the remainder lands on the largest share', () => {
  const parts = splitByWeight(new Decimal('100.00'), [
    { key: 'a', weight: new Decimal(1) },
    { key: 'b', weight: new Decimal(1) },
    { key: 'c', weight: new Decimal(1) },
    { key: 'a', weight: new Decimal(1) },
  ]);
  expect(parts.map((p) => [p.key, p.amount.toFixed(2)])).toEqual([['a', '50.00'], ['b', '25.00'], ['c', '25.00']]);
  const odd = splitByWeight(new Decimal('10.00'), [{ key: 'x', weight: new Decimal(1) }, { key: 'y', weight: new Decimal(2) }]);
  expect(odd.reduce((s, p) => s.plus(p.amount), new Decimal(0)).toFixed(2)).toBe('10.00');
  expect(odd.map((p) => p.amount.toFixed(2))).toEqual(['3.33', '6.67']);
});
