/**
 * ADR-048 — hand-typed invoices for non-contract sales (live DB).
 *
 *   MI-01  a draft is priced from its lines (qty × rate to cents), with no tax
 *   MI-02  a draft can be rewritten; once approved it cannot
 *   MI-03  posting credits each line's income account (summed per account) and debits AR the total
 *   MI-04  reversing mirrors those lines
 *   MI-05  a header, expense or unknown account is refused, with every problem listed
 *   MI-06  the source reads MANUAL and the detail carries its lines
 *   MI-11  CI-1: a currency other than USD is refused (ADR-024 ACC-CUR-001)
 *   MI-12  the client's PO / reference and a note to the client are kept, trimmed, and editable
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let clientId: string;
let invoiceId: string;

async function account(code: string, name: string, accountClass: 'INCOME' | 'EXPENSE' | 'LIABILITY', subtype: string, isPostingAllowed = true) {
  const a = await prisma.account.create({
    data: { id: `${env.orgId}-${code}`, organizationId: env.orgId, code, normalBalance: accountClass === 'EXPENSE' ? 'DEBIT' : 'CREDIT', createdBy: env.identity.userId },
  });
  await prisma.accountVersion.create({
    data: {
      accountId: a.id,
      versionNumber: 1,
      name,
      accountClass,
      accountSubtype: subtype as never,
      isPostingAllowed,
      isControlAccount: false,
      controlPostingPolicy: 'UNRESTRICTED',
      effectiveFrom: new Date('2020-01-01'),
      changedBy: env.identity.userId,
    },
  });
  return a.id;
}

const date = () => env.periods.openStart.toISOString().slice(0, 10);
const input = (lines: Array<{ description: string; quantity: string; unitPrice: string; revenueAccountCode: string }>) => ({
  clientId,
  invoiceDate: date(),
  dueDate: env.periods.openEnd.toISOString().slice(0, 10),
  currencyCode: 'USD',
  paymentTerms: 'Net 15',
  lines,
});

let hireId: string;
let scrapId: string;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  clientId = (await prisma.contract.findFirstOrThrow({ where: { organizationId: env.orgId } })).clientId;
  await account('42000', 'Other income', 'INCOME', 'OTHER_INCOME', false); // a header
  hireId = await account('42100', 'Equipment hire income', 'INCOME', 'OTHER_INCOME');
  scrapId = await account('42200', 'Sale of surplus materials', 'INCOME', 'OTHER_INCOME');
  await account('61000', 'Fuel', 'EXPENSE', 'OTHER_EXPENSE');
}, 60_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('MI-01: a draft is priced from its lines', async () => {
  const inv = await svc.clientInvoiceService.createManual(
    env.identity,
    input([
      { description: 'Excavator hire — 3 days', quantity: '3', unitPrice: '450.00', revenueAccountCode: '42100' },
      { description: 'Surplus rebar', quantity: '2.5', unitPrice: '10.01', revenueAccountCode: '42200' },
    ]),
  );
  invoiceId = inv.id;
  expect(inv.isManual).toBe(true);
  expect(inv.projectId).toBeNull();
  expect(inv.contractId).toBeNull();
  expect(inv.subtotal.toFixed(2)).toBe('1375.03');
  expect(inv.totalAmount.toFixed(2)).toBe('1375.03');
  expect(inv.documentStatus).toBe('DRAFT');
});

it('MI-02: a draft is rewritten whole; an approved one is refused', async () => {
  const updated = await svc.clientInvoiceService.updateManual(
    env.identity,
    invoiceId,
    input([
      { description: 'Excavator hire — 4 days', quantity: '4', unitPrice: '450.00', revenueAccountCode: '42100' },
      { description: 'Dump truck hire', quantity: '1', unitPrice: '200.00', revenueAccountCode: '42100' },
      { description: 'Surplus rebar', quantity: '10', unitPrice: '12.00', revenueAccountCode: '42200' },
    ]),
  );
  expect(updated.subtotal.toFixed(2)).toBe('2120.00');
  expect(updated.lines.map((l) => l.description)).toEqual(['Excavator hire — 4 days', 'Dump truck hire', 'Surplus rebar']);

  await svc.clientInvoiceService.approve(env.identity, invoiceId);
  await expect(
    svc.clientInvoiceService.updateManual(env.identity, invoiceId, input([{ description: 'x', quantity: '1', unitPrice: '1', revenueAccountCode: '42100' }])),
  ).rejects.toThrow(/Only a draft invoice can be edited/);
});

it('MI-03: posting credits each income account and debits AR the total', async () => {
  const result = await svc.clientInvoiceService.post(env.identity, { invoiceId });
  const lines = await prisma.journalLine.findMany({ where: { journalEntryId: result.journalEntryId } });
  const byAccount = (id: string) => lines.filter((l) => l.accountId === id);
  // 4×450 + 200 = 2000 to hire; 120 to scrap; one credit per account.
  expect(byAccount(hireId).map((l) => l.creditAmount.toFixed(2))).toEqual(['2000.00']);
  expect(byAccount(scrapId).map((l) => l.creditAmount.toFixed(2))).toEqual(['120.00']);
  const debits = lines.reduce((s, l) => s + Number(l.debitAmount), 0);
  const credits = lines.reduce((s, l) => s + Number(l.creditAmount), 0);
  expect(debits.toFixed(2)).toBe('2120.00');
  expect(credits.toFixed(2)).toBe('2120.00');
});

it('MI-04: reversing mirrors the lines', async () => {
  await svc.clientInvoiceService.reverse(env.identity, invoiceId, { reversalDate: date(), reason: 'MI-04' });
  const inv = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const lines = await prisma.journalLine.findMany({ where: { journalEntryId: inv.reversalJournalEntryId! } });
  expect(lines.filter((l) => l.accountId === hireId).map((l) => l.debitAmount.toFixed(2))).toEqual(['2000.00']);
});

it('MI-05: refuses a header, an expense and an unknown account, listing every problem', async () => {
  const err = (await svc.clientInvoiceService
    .createManual(
      env.identity,
      input([
        { description: 'a', quantity: '1', unitPrice: '1', revenueAccountCode: '42000' },
        { description: 'b', quantity: '1', unitPrice: '1', revenueAccountCode: '61000' },
        { description: 'c', quantity: '1', unitPrice: '1', revenueAccountCode: '99999' },
      ]),
    )
    .catch((e: { getResponse: () => unknown }) => e.getResponse())) as { details: { problems: string[] } };
  expect(err.details.problems).toEqual([
    '42000 is not an active income account that accepts postings.',
    '61000 is not an active income account that accepts postings.',
    '99999 is not an active income account that accepts postings.',
  ]);
});

it('MI-06: the detail reads source MANUAL with its lines', async () => {
  const detail = await svc.clientInvoiceService.findById(env.identity, invoiceId);
  expect(detail.source).toEqual({ kind: 'MANUAL', label: null, id: null });
  expect(detail.lines[2]).toEqual({
    lineNo: 3,
    description: 'Surplus rebar',
    quantity: '10',
    unitPrice: '12.00',
    amount: '120.00',
    revenueAccountCode: '42200',
  });
});

it('MI-07 (Step 2g): an unposted invoice is cancelled; a posted one is refused', async () => {
  const draft = await svc.clientInvoiceService.createManual(
    env.identity,
    input([{ description: 'Wrong client', quantity: '1', unitPrice: '10.00', revenueAccountCode: '42100' }]),
  );
  const cancelled = await svc.clientInvoiceService.cancelDraft(env.identity, draft.id, 'Raised for the wrong client');
  expect(cancelled.documentStatus).toBe('CANCELLED');
  expect(cancelled.cancellationReason).toBe('Raised for the wrong client');
  await expect(svc.clientInvoiceService.cancelDraft(env.identity, draft.id)).rejects.toThrow(/already cancelled/);
  // MI-01's invoice was posted (then reversed): it is in the ledger, so it cannot be cancelled.
  await expect(svc.clientInvoiceService.cancelDraft(env.identity, invoiceId)).rejects.toThrow(/in the ledger/);
});

it('MI-08 (ADR-046 §2): Issue takes a draft to a numbered, posted invoice in one action', async () => {
  const draft = await svc.clientInvoiceService.createManual(
    env.identity,
    input([{ description: 'Generator hire', quantity: '2', unitPrice: '150.00', revenueAccountCode: '42100' }]),
  );
  const issued = await svc.clientInvoiceService.issue(env.identity, draft.id);
  expect(issued.documentStatus).toBe('APPROVED');
  expect(issued.postingStatus).toBe('POSTED');
  expect(issued.invoiceNumber).toMatch(/^INV-/);
  expect(issued.postedJournalEntryId).not.toBeNull();
  await expect(svc.clientInvoiceService.issue(env.identity, draft.id)).rejects.toThrow(/already issued/);
});

it('MI-09 (ADR-046 §2): a refused Issue leaves the draft a draft, unnumbered', async () => {
  const draft = await svc.clientInvoiceService.createManual(
    env.identity,
    input([{ description: 'Scaffold hire', quantity: '1', unitPrice: '80.00', revenueAccountCode: '42100' }]),
  );
  // Lines that no longer add up to the subtotal are refused at posting (ADR-048).
  await prisma.clientInvoice.update({ where: { id: draft.id }, data: { subtotal: '81.00' } });
  await expect(svc.clientInvoiceService.issue(env.identity, draft.id)).rejects.toThrow(/do not add up/);
  const after = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: draft.id } });
  expect(after.documentStatus).toBe('DRAFT');
  expect(after.invoiceNumber).toBeNull();

  await svc.clientInvoiceService.cancelDraft(env.identity, draft.id);
  await expect(svc.clientInvoiceService.issue(env.identity, draft.id)).rejects.toThrow(/cancelled/);
});

it('MI-10 (ADR-046 §8): above the approval amount, Issue waits for a second person to approve', async () => {
  await svc.accountingConfig.updateApprovalSettings(env.identity, {
    invoiceApprovalAbove: '1000.00',
    billApprovalAbove: null,
    autoPostToleratedBills: false,
    paymentAutoApproveUpTo: '1000.00',
  });
  try {
    const small = await svc.clientInvoiceService.createManual(env.identity, input([{ description: 'Small hire', quantity: '1', unitPrice: '100.00', revenueAccountCode: '42100' }]));
    expect((await svc.clientInvoiceService.issue(env.identity, small.id)).postingStatus).toBe('POSTED');

    const large = await svc.clientInvoiceService.createManual(env.identity, input([{ description: 'Crane hire', quantity: '1', unitPrice: '1200.00', revenueAccountCode: '42100' }]));
    await expect(svc.clientInvoiceService.issue(env.identity, large.id)).rejects.toMatchObject({ response: { errorCode: 'INVOICE_APPROVAL_REQUIRED' } });
    await expect(svc.clientInvoiceService.approve(env.identity, large.id)).rejects.toMatchObject({ response: { errorCode: 'INVOICE_APPROVER_IS_PREPARER' } });

    const approver = { ...env.identity, userId: `${env.identity.userId}-approver` };
    await svc.clientInvoiceService.approve(approver, large.id);
    const issued = await svc.clientInvoiceService.issue(env.identity, large.id);
    expect(issued.postingStatus).toBe('POSTED');
  } finally {
    await svc.accountingConfig.updateApprovalSettings(env.identity, {
      invoiceApprovalAbove: null, billApprovalAbove: null, autoPostToleratedBills: false, paymentAutoApproveUpTo: '1000.00',
    });
  }
});

it('MI-11 (CI-1): an invoice in another currency than USD is refused', async () => {
  const err = (await svc.clientInvoiceService
    .createManual(env.identity, {
      ...input([{ description: 'Pump hire', quantity: '1', unitPrice: '10.00', revenueAccountCode: '42100' }]),
      currencyCode: 'EUR',
    })
    .catch((e: { getResponse: () => unknown }) => e.getResponse())) as { details: { problems: string[] } };
  expect(err.details.problems).toEqual(['Invoices are raised in US dollars (USD) only.']);
});

it("MI-12: the client's PO / reference and the note to the client are kept, trimmed and editable", async () => {
  const line = [{ description: 'Pump hire', quantity: '1', unitPrice: '10.00', revenueAccountCode: '42100' }];
  const draft = await svc.clientInvoiceService.createManual(env.identity, {
    ...input(line),
    clientReference: '  PO-4471 ',
    notes: ' Pump hire for site B. ',
  });
  expect(draft).toMatchObject({ clientReference: 'PO-4471', notes: 'Pump hire for site B.' });

  const edited = await svc.clientInvoiceService.updateManual(env.identity, draft.id, {
    ...input(line),
    clientReference: '   ',
    notes: '',
  });
  expect(edited).toMatchObject({ clientReference: null, notes: null });
});
