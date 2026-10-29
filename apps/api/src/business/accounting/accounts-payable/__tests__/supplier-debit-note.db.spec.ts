/**
 * AP-4 — a credit from the supplier against a posted bill (live DB).
 *
 *   DN-01  posts at once: Dr AP / Cr the bill's cost account with its project; the bill's balance
 *          falls; the AP tie-out still agrees; the supplier statement shows it
 *   DN-02  capped at what is left to pay on the bill; a reason is required
 *   DN-03  a bill with a posted debit note cannot be reversed; reversing the note brings the
 *          balance back, and then the bill can be reversed
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { CommitmentLedgerWriter } from '../../../procurement/commitment-ledger/application/commitment-ledger-writer.service';
import { CommitmentLedgerRepository } from '../../../procurement/commitment-ledger/infrastructure/commitment-ledger.repository';
import { SupplierDebitNoteService } from '../application/supplier-debit-note.service';
import { SupplierStatementService } from '../application/supplier-statement.service';
import { SupplierStatementRepository } from '../infrastructure/supplier-statement.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let notes: SupplierDebitNoteService;
let billId: string;
const other = () => ({ ...env.identity, userId: 'second-approver' });
const day = () => env.periods.openStart.toISOString().slice(0, 10);
const outstanding = async () => (await prisma.supplierBill.findUniqueOrThrow({ where: { id: billId } })).outstandingAmount.toFixed(2);
const apCheck = async () =>
  (await svc.reconciliationService.runFullReconciliation(env.identity, { arAccountCode: env.accounts.arCode, apAccountCode: env.accounts.apCode }))
    .checks.find((c) => c.subledgerType === 'AP')!;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  notes = new SupplierDebitNoteService({ getClient: () => prisma } as never, svc.sequenceRepo, svc.postingService as never, new CommitmentLedgerWriter(new CommitmentLedgerRepository()));
  await prisma.account.update({ where: { id: env.accounts.ctrlId }, data: { status: 'INACTIVE' } });
  const bill = await svc.supplierBillService.create(env.identity, {
    supplierId: env.supplierId, supplierInvoiceNumber: 'SUP-DN-1', billDate: day(), dueDate: day(), currencyCode: 'USD',
    lines: [{ description: 'Rebar 12mm', netAmount: 1000, vatAmount: 0, expenseProfileCode: env.postingProfileCode }],
  } as never);
  await svc.supplierBillService.submit(env.identity, bill.id);
  await svc.supplierBillService.approve(other(), bill.id);
  await svc.supplierBillService.post(env.identity, { billId: bill.id });
  billId = bill.id;
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('DN-01: posts at once — Dr AP / Cr the bill cost line — and the bill balance falls', async () => {
  const n = await notes.record(env.identity, { billId, amount: '300.00', accountingDate: day(), reason: '2 t returned damaged', supplierReference: 'CN-88' });
  expect(n).toMatchObject({ status: 'POSTED', amount: '300.00', supplierReference: 'CN-88' });
  expect(n.debitNoteNumber).toMatch(/^DN-/);
  const row = await prisma.supplierDebitNote.findUniqueOrThrow({ where: { id: n.id } });
  const lines = await prisma.journalLine.findMany({ where: { journalEntryId: row.postedJournalEntryId! } });
  expect(lines.find((l) => l.accountId === env.accounts.apId)?.debitAmount.toFixed(2)).toBe('300.00');
  expect(lines.find((l) => l.accountId === env.accounts.expId)?.creditAmount.toFixed(2)).toBe('300.00');
  expect(await outstanding()).toBe('700.00');
  expect((await apCheck()).reconciled).toBe(true);

  const s = await new SupplierStatementService({ getClient: () => prisma } as never, new SupplierStatementRepository()).statement(env.identity, env.supplierId, day(), day());
  expect(s.lines.map((l) => [l.kind, l.debit, l.credit])).toEqual([['BILL', null, '1000.00'], ['DEBIT_NOTE', '300.00', null]]);
  expect(s.closingBalance).toBe('700.00');
});

it('DN-02: capped at what is left to pay; a reason is required', async () => {
  await expect(notes.record(env.identity, { billId, amount: '700.01', accountingDate: day(), reason: 'Too much' })).rejects.toMatchObject({ status: 400 });
  await expect(notes.record(env.identity, { billId, amount: '10.00', accountingDate: day(), reason: ' ' })).rejects.toMatchObject({ status: 400 });
  expect(await outstanding()).toBe('700.00');
});

it('DN-03: the bill cannot be reversed under a debit note; reversing the note brings the balance back', async () => {
  await expect(svc.supplierBillService.reverse(env.identity, billId, { reversalDate: day(), reason: 'Wrong supplier' })).rejects.toMatchObject({ status: 400 });
  const [n] = await notes.listForBill(env.identity, billId);
  const r = await notes.reverse(env.identity, n!.id, { reversalDate: day(), reason: 'Supplier withdrew the credit' });
  expect(r.status).toBe('REVERSED');
  await expect(notes.reverse(env.identity, n!.id, { reversalDate: day(), reason: 'again' })).rejects.toMatchObject({ status: 409 });
  expect(await outstanding()).toBe('1000.00');
  expect((await apCheck()).reconciled).toBe(true);
  await svc.supplierBillService.reverse(env.identity, billId, { reversalDate: day(), reason: 'Wrong supplier' });
});
