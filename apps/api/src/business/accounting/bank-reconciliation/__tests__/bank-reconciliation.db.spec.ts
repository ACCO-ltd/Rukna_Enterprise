/**
 * Step 6 — bank reconciliation against the live ledger.
 *
 *   BR-01  a statement that does not add up is refused; one that does is imported, and its lines
 *          get the unambiguous suggestions
 *   BR-02  accept the suggestions, post the bank charge from its line, and reconcile; a cheque the
 *          bank has not seen stays outstanding; the reconciled statement is frozen
 *   BR-03  matching guards: wrong amount, a line of another account, a ledger line already cleared
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { BankReconciliationService } from '../application/bank-reconciliation.service';
import { BankStatementRepository } from '../infrastructure/bank-statement.repository';
import { transferProof } from '../../__tests__/helpers/payment-proof';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let rec: BankReconciliationService;
let start: Date;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (days: number) => iso(new Date(start.getTime() + days * 86_400_000));

async function payment(amount: number, offset: number) {
  const p = await prisma.supplierPayment.create({
    data: {
      organizationId: env.orgId, supplierId: env.supplierId, bankAccountId: env.bankAccountId,
      paymentDate: new Date(plus(offset)), accountingDate: new Date(plus(offset)), currencyCode: 'USD',
      totalAmount: new Decimal(amount), allocatedAmount: new Decimal(0), unallocatedAmount: new Decimal(amount),
      paymentMethod: 'BANK_TRANSFER', documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED', createdBy: env.identity.userId,
    },
  });
  await svc.supplierPaymentService.post(env.identity, {
    paymentId: p.id, apAccountCode: env.accounts.apCode, bankGlCode: env.accounts.bankCode, supplierAdvanceCode: env.accounts.advOutCode,
  });
}

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  start = env.periods.openStart;
  const outbox = { record: async () => undefined } as never;
  rec = new BankReconciliationService(new BankStatementRepository({ getClient: () => prisma } as never), svc.postingService as never, outbox);

  // The ledger: 1000 received on day 1, 300 paid on day 3, a 200 cheque written on day 10.
  await svc.customerReceiptService.receive(env.identity, {
    ...transferProof(),
    clientId: env.clientId, bankAccountId: env.bankAccountId, receiptDate: plus(1), amount: '1000.00', currency: 'USD', allocations: [],
  });
  await payment(300, 3);
  await payment(200, 10);
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

// The bank saw the receipt and the 300 payment, and took a 15 charge; the 200 cheque is not presented.
const statement = (closingBalance: string) => ({
  bankAccountId: env.bankAccountId, periodStart: plus(0), statementDate: plus(20), openingBalance: '0.00', closingBalance,
  lines: [
    { transactionDate: plus(2), description: 'Transfer in', amount: '1000.00' },
    { transactionDate: plus(4), description: 'Payment out', reference: 'TRF-77', amount: '-300.00' },
    { transactionDate: plus(15), description: 'Monthly charge', amount: '-15.00' },
  ],
});
let statementId: string;

it('BR-01: a statement must add up; an imported one gets its unambiguous suggestions', async () => {
  await expect(rec.import(env.identity, statement('700.00'))).rejects.toMatchObject({ response: { errorCode: 'STATEMENT_DOES_NOT_ADD_UP' } });
  const w = await rec.import(env.identity, statement('685.00'));
  statementId = w.statement.id;
  expect(w.lines.map((l) => [l.amount, l.matchStatus, l.suggestion?.amount ?? null])).toEqual([
    ['1000.00', 'UNMATCHED', '1000.00'],
    ['-300.00', 'UNMATCHED', '-300.00'],
    ['-15.00', 'UNMATCHED', null],
  ]);
  expect(w.uncleared).toHaveLength(3);
  expect(w.canReconcile).toBe(false);
});

it('BR-02: accept, post the charge, reconcile with the cheque outstanding; then frozen', async () => {
  let w = await rec.acceptSuggestions(env.identity, statementId);
  expect(w.lines.map((l) => l.matchStatus)).toEqual(['MATCHED', 'MATCHED', 'UNMATCHED']);

  const charge = w.lines[2];
  await expect(rec.reconcileStatement(env.identity, statementId)).rejects.toMatchObject({ response: { errorCode: 'LINES_UNMATCHED' } });
  await expect(rec.postLine(env.identity, statementId, charge.id, { accountId: env.accounts.bankId })).rejects.toMatchObject({ response: { errorCode: 'ACCOUNT_IS_THE_BANK' } });
  w = await rec.postLine(env.identity, statementId, charge.id, { accountId: env.accounts.expId, memo: 'Bank charges' });
  expect(w.lines[2]).toMatchObject({ matchStatus: 'POSTED', matched: { amount: '-15.00' } });

  // Ledger 1000 − 300 − 200 − 15 = 485; the 200 cheque is outstanding; 485 + 200 = 685.
  expect(w.reconciliation).toMatchObject({ ledgerBalance: '485.00', outstanding: '-200.00', adjustedLedger: '685.00', difference: '0.00', balanced: true });
  expect(w.uncleared.map((l) => l.amount)).toEqual(['-200.00']);
  expect(w.canReconcile).toBe(true);

  const charged = await prisma.journalLine.findFirstOrThrow({ where: { entry: { sourceDocumentType: 'BANK_STATEMENT', sourceDocumentId: charge.id }, accountId: env.accounts.expId } });
  expect(charged.debitAmount.toFixed(2)).toBe('15.00');

  w = await rec.reconcileStatement(env.identity, statementId);
  expect(w.statement.status).toBe('RECONCILED');
  await expect(rec.unmatch(env.identity, statementId, w.lines[0].id)).rejects.toMatchObject({ response: { errorCode: 'STATEMENT_RECONCILED' } });
  await expect(rec.remove(env.identity, statementId)).rejects.toMatchObject({ response: { errorCode: 'STATEMENT_RECONCILED' } });
});

it('BR-03: matching guards', async () => {
  // A second statement in which the bank finally pays the cheque, but for the wrong figure first.
  const w = await rec.import(env.identity, {
    bankAccountId: env.bankAccountId, periodStart: plus(21), statementDate: plus(25), openingBalance: '685.00', closingBalance: '485.00',
    lines: [{ transactionDate: plus(22), description: 'Cheque 1001', amount: '-200.00' }],
  });
  expect(w.previousClosing).toBe('685.00');
  const cheque = w.uncleared.find((l) => l.amount === '-200.00')!;
  const receiptLine = (await rec.workspace(env.identity, statementId)).lines[0].matched!;

  await expect(rec.match(env.identity, w.statement.id, w.lines[0].id, receiptLine.journalLineId))
    .rejects.toMatchObject({ response: { errorCode: 'LEDGER_LINE_ALREADY_CLEARED' } });
  const other = await prisma.journalLine.findFirstOrThrow({ where: { accountId: env.accounts.expId } });
  await expect(rec.match(env.identity, w.statement.id, w.lines[0].id, other.id))
    .rejects.toMatchObject({ response: { errorCode: 'LEDGER_LINE_NOT_FOUND' } });

  const matched = await rec.match(env.identity, w.statement.id, w.lines[0].id, cheque.journalLineId);
  expect(matched.reconciliation.balanced).toBe(true);
  expect(matched.canReconcile).toBe(true);
  const back = await rec.unmatch(env.identity, w.statement.id, w.lines[0].id);
  expect(back.lines[0].matchStatus).toBe('UNMATCHED');
  await rec.remove(env.identity, w.statement.id);
  expect(await prisma.bankStatement.count({ where: { id: w.statement.id } })).toBe(0);
});

it('BR-04: statements follow each other — no overlap, and each opens where the last one closed (B-3)', async () => {
  const next = (periodStart: string, openingBalance: string) => ({
    bankAccountId: env.bankAccountId, periodStart, statementDate: plus(28), openingBalance,
    closingBalance: (Number(openingBalance) - 200).toFixed(2),
    lines: [{ transactionDate: plus(27), description: 'Cheque 1001', amount: '-200.00' }],
  });
  await expect(rec.import(env.identity, next(plus(20), '685.00'))).rejects.toMatchObject({ response: { errorCode: 'STATEMENT_PERIOD_OVERLAPS' } });
  await expect(rec.import(env.identity, next(plus(26), '700.00'))).rejects.toMatchObject({ response: { errorCode: 'OPENING_BALANCE_BREAK', details: { expectedOpening: '685.00' } } });
  const ok = await rec.import(env.identity, next(plus(26), '685.00'));
  await rec.remove(env.identity, ok.statement.id);
});
