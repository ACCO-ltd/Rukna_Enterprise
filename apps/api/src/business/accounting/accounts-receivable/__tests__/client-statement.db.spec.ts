/**
 * AR-3 — a client statement of account (live DB).
 *
 *   ST-01  invoices, a part payment with cash left on account, a credit note and a reversed
 *          receipt: each a line with a running balance, and the closing balance equals open
 *          invoice balances less cash on account
 *   ST-02  a later period opens on the earlier closing balance; a bad period is refused
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { PostingAccountResolver } from '../../accounting-core/application/posting-account-resolver.service';
import { AccountRepository } from '../../accounting-core/infrastructure/account.repository';
import { CreditNoteService } from '../application/credit-note.service';
import { ClientStatementService } from '../application/client-statement.service';
import { ClientStatementRepository } from '../infrastructure/client-statement.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let statements: ClientStatementService;
let day: string;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  statements = new ClientStatementService({ getClient: () => prisma } as never, new ClientStatementRepository());
  for (const [code, name, accountClass, subtype] of [
    ['42100', 'Equipment hire income', 'INCOME', 'OTHER_INCOME'],
    ['22000', 'Sales tax payable', 'LIABILITY', 'VAT_OUTPUT_PAYABLE'],
  ] as const) {
    const a = await prisma.account.create({ data: { id: `${env.orgId}-${code}`, organizationId: env.orgId, code, normalBalance: 'CREDIT', createdBy: env.identity.userId } });
    await prisma.accountVersion.create({
      data: { accountId: a.id, versionNumber: 1, name, accountClass, accountSubtype: subtype, isPostingAllowed: true, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: new Date('2020-01-01'), changedBy: env.identity.userId },
    });
  }
  day = env.periods.openStart.toISOString().slice(0, 10);
  const sale = (amount: string) =>
    svc.clientInvoiceService.createManual(env.identity, {
      clientId: env.clientId, invoiceDate: day, dueDate: day, currencyCode: 'USD', paymentTerms: 'Due on receipt',
      lines: [{ description: 'Crane hire', quantity: '1', unitPrice: amount, revenueAccountCode: '42100' }],
    });
  // 5% tax: 1000 → 1050; 200 → 210.
  const a = await sale('1000.00');
  await svc.clientInvoiceService.issue(env.identity, a.id);
  const b = await sale('200.00');
  await svc.clientInvoiceService.issue(env.identity, b.id);
  const receive = (amount: string, applied: number) =>
    svc.customerReceiptService.receive(env.identity, {
      clientId: env.clientId, bankAccountId: env.bankAccountId, receiptDate: day, amount, currency: 'USD', reference: 'TT',
      allocations: [{ clientInvoiceId: a.id, amount: applied }],
    });
  await receive('800.00', 700); // 100 held on account
  const bounced = await receive('50.00', 50);
  await svc.customerReceiptService.reverse(env.identity, bounced.id, { reversalDate: day, reason: 'Cheque bounced' });
  const creditNotes = new CreditNoteService({ getClient: () => prisma } as never, svc.sequenceRepo, new PostingAccountResolver(new AccountRepository()), svc.postingService as never);
  const cn = await creditNotes.createCreditNote(env.identity, { invoiceId: b.id, reason: 'PRICE_ERROR', netAmount: '20.00', accountingDate: day });
  await creditNotes.postCreditNote(env.identity, { creditNoteId: cn.id });
}, 90_000);

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM credit_notes WHERE organization_id = ${env.orgId}`;
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('ST-01: every movement is a line; the closing balance is open invoices less cash on account', async () => {
  const s = await statements.statement(env.identity, env.clientId, day, day);
  expect(s.openingBalance).toBe('0.00');
  expect(s.lines.map((l) => l.kind).sort()).toEqual(['CREDIT_NOTE', 'INVOICE', 'INVOICE', 'RECEIPT', 'RECEIPT', 'RECEIPT_REVERSAL'].sort());
  // 1050 + 210 − 800 − 50 + 50 − 21 = 439
  expect(s.closingBalance).toBe('439.00');
  expect(s.lines.at(-1)!.balance).toBe(s.closingBalance);
  expect(s.onAccount).toBe('100.00');

  const invoices = await prisma.clientInvoice.findMany({ where: { organizationId: env.orgId, clientId: env.clientId, postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] } } });
  const open = invoices.reduce((sum, i) => sum.plus(i.outstandingAmount), new Decimal(0));
  expect(open.minus(s.onAccount).toFixed(2)).toBe(s.closingBalance);
});

it('ST-02: a later period opens where the earlier one closed; a bad period is refused', async () => {
  const later = new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  const s = await statements.statement(env.identity, env.clientId, later, later);
  expect(s.openingBalance).toBe('439.00');
  expect(s.lines).toEqual([]);
  await expect(statements.statement(env.identity, env.clientId, later, day)).rejects.toMatchObject({ response: { errorCode: 'STATEMENT_PERIOD_INVALID' } });
});
