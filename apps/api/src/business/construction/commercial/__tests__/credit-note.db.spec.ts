/**
 * Slice 6B — CreditNoteService DB integration tests.
 *
 * Seed: org + project + contract + POSTED invoice (net 100,000 / VAT 5,000 / total 105,000 / outstanding 105,000).
 *
 * CN-DB-01: createCreditNote produces a NOT_POSTED credit note
 * CN-DB-02: postCreditNote produces CN-000001 and sets status to POSTED
 * CN-DB-03: posted journal is balanced (Σ debit = Σ credit)
 * CN-DB-04: AR journal line is a CREDIT of totalAmount
 * CN-DB-05: Revenue journal line is a DEBIT of netAmount
 * CN-DB-06: VAT journal line is a DEBIT of vatAmount
 * CN-DB-07: invoice.outstandingAmount is decremented by totalAmount after posting
 * CN-DB-08: original invoice totalAmount is not changed
 * CN-DB-09: credit > outstanding → CREDIT_EXCEEDS_OUTSTANDING
 * CN-DB-10: duplicate post → ConflictException
 * CN-DB-11: CN against NOT_POSTED invoice → BadRequestException
 */

import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

import {
  AccountingFixtureFactory,
  type AccountingTestEnv,
} from '../../../accounting/__tests__/helpers/fixture.factory.js';
import { buildServices } from '../../../accounting/__tests__/helpers/build-services.js';
import { PostingAccountResolver } from '../../../accounting/accounting-core/application/posting-account-resolver.service.js';
import { AccountRepository } from '../../../accounting/accounting-core/infrastructure/account.repository.js';
import { CreditNoteService } from '../../../accounting/accounts-receivable/application/credit-note.service.js';

describe('CreditNoteService — DB integration (Slice 6B)', () => {
  const prisma = new PrismaClient();
  let env: AccountingTestEnv;
  let service: CreditNoteService;
  let identity: RequestIdentity;
  let contractId: string;
  let projectId: string;
  let vatAccountCode: string;

  // Seeded accounts from fixture:
  // AR-TEST  → ACCOUNTS_RECEIVABLE
  // REV-TEST → PROJECT_REVENUE
  // VT-TEST  → VAT_OUTPUT_PAYABLE (created below)

  const NET = '100000.00';
  const VAT = '5000.00';
  const TOTAL = '105000.00';

  async function makePostedInvoice(outstandingOverride?: string): Promise<string> {
    const inv = await prisma.clientInvoice.create({
      data: {
        organizationId: env.orgId,
        clientId: env.clientId,
        projectId,
        contractId,
        invoiceDate: new Date('2026-09-01'),
        dueDate: new Date('2026-10-31'),
        subtotal: new Decimal(NET),
        vatAmount: new Decimal(VAT),
        totalAmount: new Decimal(TOTAL),
        outstandingAmount: new Decimal(outstandingOverride ?? TOTAL),
        currencyCode: 'USD',
        billingAddressSnapshot: {},
        postingStatus: 'POSTED',
        documentStatus: 'APPROVED',
        createdBy: identity.userId,
      },
      select: { id: true },
    });
    return inv.id;
  }

  async function makeNotPostedInvoice(): Promise<string> {
    const inv = await prisma.clientInvoice.create({
      data: {
        organizationId: env.orgId,
        clientId: env.clientId,
        projectId,
        contractId,
        invoiceDate: new Date('2026-09-01'),
        subtotal: new Decimal(NET),
        vatAmount: new Decimal(VAT),
        totalAmount: new Decimal(TOTAL),
        outstandingAmount: new Decimal(TOTAL),
        currencyCode: 'USD',
        billingAddressSnapshot: {},
        postingStatus: 'NOT_POSTED',
        documentStatus: 'DRAFT',
        createdBy: identity.userId,
      },
      select: { id: true },
    });
    return inv.id;
  }

  beforeAll(async () => {
    env = await AccountingFixtureFactory.create(prisma);
    identity = env.identity;

    // Pull the contract seeded by the fixture factory
    const contract = await prisma.contract.findFirstOrThrow({
      where: { organizationId: env.orgId },
      select: { id: true, projectId: true },
    });
    contractId = contract.id;
    projectId = contract.projectId;

    // Seed a VAT_OUTPUT_PAYABLE account (not in fixture factory by default)
    vatAccountCode = `VT-${env.orgId.slice(-8)}`;
    const vatAccId = `${env.orgId}-${vatAccountCode}`;
    await prisma.account.create({
      data: {
        id: vatAccId,
        organizationId: env.orgId,
        code: vatAccountCode,
        normalBalance: 'CREDIT',
        createdBy: identity.userId,
      },
    });
    await prisma.accountVersion.create({
      data: {
        accountId: vatAccId,
        versionNumber: 1,
        name: 'VAT Output Payable',
        accountClass: 'LIABILITY',
        accountSubtype: 'VAT_OUTPUT_PAYABLE',
        isPostingAllowed: true,
        isControlAccount: false,
        controlPostingPolicy: 'UNRESTRICTED',
        effectiveFrom: new Date('2025-01-01'),
        effectiveTo: null,
        changedBy: identity.userId,
      },
    });

    // Also add CREDIT_NOTE to document number sequences
    await prisma.documentNumberSequence.create({
      data: {
        organizationId: env.orgId,
        documentType: 'CREDIT_NOTE',
        journalCategory: null,
        prefix: 'CN-',
        nextNumber: 1,
        paddingLength: 6,
        status: 'ACTIVE',
      },
    });

    const services = buildServices(prisma);
    const tenancy = { getClient: () => prisma };
    const resolver = new PostingAccountResolver(new AccountRepository());

    service = new CreditNoteService(
      tenancy as never,
      services.sequenceRepo,
      resolver,
      services.postingService as never,
    );
  }, 60_000);

  afterAll(async () => {
    // Delete credit notes and collection tables before the fixture cleanup
    await prisma.$executeRaw`DELETE FROM credit_notes WHERE organization_id = ${env.orgId}`;
    await prisma.$executeRaw`DELETE FROM invoice_disputes WHERE organization_id = ${env.orgId}`;
    await prisma.$executeRaw`DELETE FROM invoice_payment_promises WHERE organization_id = ${env.orgId}`;
    await prisma.$executeRaw`DELETE FROM invoice_follow_ups WHERE organization_id = ${env.orgId}`;
    await AccountingFixtureFactory.cleanup(prisma, env.orgId);
    await prisma.$disconnect();
  });

  // ─── CN-DB-01: createCreditNote produces NOT_POSTED ──────────────────────────

  it('CN-DB-01: createCreditNote produces a NOT_POSTED credit note', async () => {
    const invoiceId = await makePostedInvoice();

    const cn = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'OMISSION',
      netAmount: '1000.00',
      accountingDate: '2026-09-17',
    });

    expect(cn.postingStatus).toBe('NOT_POSTED');
    expect(new Decimal(cn.netAmount.toString()).toFixed(2)).toBe('1000.00');
    expect(new Decimal(cn.vatAmount.toString()).toFixed(2)).toBe('50.00');
    expect(new Decimal(cn.totalAmount.toString()).toFixed(2)).toBe('1050.00');
  });

  // ─── CN-DB-02: postCreditNote produces CN-000001 and POSTED ──────────────────

  it('CN-DB-02: postCreditNote produces CN-000001 and sets postingStatus to POSTED', async () => {
    const invoiceId = await makePostedInvoice();

    const cn = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'CORRECTION',
      netAmount: '1000.00',
      accountingDate: '2026-09-17',
    });

    const posted = await service.postCreditNote(identity, {
      creditNoteId: cn.id,
      arAccountCode: env.accounts.arCode,
      revenueAccountCode: env.accounts.revCode,
      vatAccountCode,
    });

    expect(posted.postingStatus).toBe('POSTED');
    expect(posted.creditNoteNumber).toMatch(/^CN-\d+$/);
    expect(posted.postedJournalEntryId).toBeTruthy();
  });

  // ─── CN-DB-03: posted journal is balanced ────────────────────────────────────

  it('CN-DB-03: posted journal is balanced (Σ debit = Σ credit)', async () => {
    const invoiceId = await makePostedInvoice();

    const cn = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'PRICE_ERROR',
      netAmount: '2000.00',
      accountingDate: '2026-09-17',
    });

    const posted = await service.postCreditNote(identity, {
      creditNoteId: cn.id,
      arAccountCode: env.accounts.arCode,
      revenueAccountCode: env.accounts.revCode,
      vatAccountCode,
    });

    const lines = await prisma.journalLine.findMany({
      where: { journalEntryId: posted.postedJournalEntryId! },
    });

    const totalDebit = lines.reduce(
      (sum, l) => sum.plus(new Decimal(l.debitAmount.toString())),
      new Decimal(0),
    );
    const totalCredit = lines.reduce(
      (sum, l) => sum.plus(new Decimal(l.creditAmount.toString())),
      new Decimal(0),
    );

    expect(totalDebit.toFixed(2)).toBe(totalCredit.toFixed(2));
  });

  // ─── CN-DB-04: AR line is a CREDIT of totalAmount ────────────────────────────

  it('CN-DB-04: AR journal line is a CREDIT of totalAmount', async () => {
    const invoiceId = await makePostedInvoice();

    const cn = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'OMISSION',
      netAmount: '3000.00',
      accountingDate: '2026-09-17',
    });

    const posted = await service.postCreditNote(identity, {
      creditNoteId: cn.id,
      arAccountCode: env.accounts.arCode,
      revenueAccountCode: env.accounts.revCode,
      vatAccountCode,
    });

    const lines = await prisma.journalLine.findMany({
      where: { journalEntryId: posted.postedJournalEntryId!, accountId: env.accounts.arId },
    });

    expect(lines).toHaveLength(1);
    const arLine = lines[0]!;
    // totalAmount = 3000 * 1.05 = 3150
    expect(new Decimal(arLine.creditAmount.toString()).toFixed(2)).toBe('3150.00');
    expect(new Decimal(arLine.debitAmount.toString()).toFixed(2)).toBe('0.00');
  });

  // ─── CN-DB-05: Revenue line is a DEBIT of netAmount ─────────────────────────

  it('CN-DB-05: Revenue journal line is a DEBIT of netAmount', async () => {
    const invoiceId = await makePostedInvoice();

    const cn = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'PRICE_ERROR',
      netAmount: '4000.00',
      accountingDate: '2026-09-17',
    });

    const posted = await service.postCreditNote(identity, {
      creditNoteId: cn.id,
      arAccountCode: env.accounts.arCode,
      revenueAccountCode: env.accounts.revCode,
      vatAccountCode,
    });

    const lines = await prisma.journalLine.findMany({
      where: { journalEntryId: posted.postedJournalEntryId!, accountId: env.accounts.revId },
    });

    expect(lines).toHaveLength(1);
    const revLine = lines[0]!;
    expect(new Decimal(revLine.debitAmount.toString()).toFixed(2)).toBe('4000.00');
    expect(new Decimal(revLine.creditAmount.toString()).toFixed(2)).toBe('0.00');
  });

  // ─── CN-DB-06: VAT line is a DEBIT of vatAmount ──────────────────────────────

  it('CN-DB-06: VAT journal line is a DEBIT of vatAmount', async () => {
    const invoiceId = await makePostedInvoice();

    const cn = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'CORRECTION',
      netAmount: '5000.00',
      accountingDate: '2026-09-17',
    });

    const posted = await service.postCreditNote(identity, {
      creditNoteId: cn.id,
      arAccountCode: env.accounts.arCode,
      revenueAccountCode: env.accounts.revCode,
      vatAccountCode,
    });

    const vatAccId = `${env.orgId}-${vatAccountCode}`;
    const lines = await prisma.journalLine.findMany({
      where: { journalEntryId: posted.postedJournalEntryId!, accountId: vatAccId },
    });

    expect(lines).toHaveLength(1);
    const vatLine = lines[0]!;
    // vatAmount = 5000 * 0.05 = 250
    expect(new Decimal(vatLine.debitAmount.toString()).toFixed(2)).toBe('250.00');
    expect(new Decimal(vatLine.creditAmount.toString()).toFixed(2)).toBe('0.00');
  });

  // ─── CN-DB-07: invoice.outstandingAmount is decremented by totalAmount ────────

  it('CN-DB-07: invoice.outstandingAmount is decremented by credit note totalAmount after posting', async () => {
    const invoiceId = await makePostedInvoice();

    const cn = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'OMISSION',
      netAmount: '10000.00',
      accountingDate: '2026-09-17',
    });

    await service.postCreditNote(identity, {
      creditNoteId: cn.id,
      arAccountCode: env.accounts.arCode,
      revenueAccountCode: env.accounts.revCode,
      vatAccountCode,
    });

    const invoice = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { outstandingAmount: true },
    });

    // CN totalAmount = 10000 + 500 = 10500; original outstanding was 105000
    const expectedOutstanding = new Decimal(TOTAL).minus('10500.00');
    expect(new Decimal(invoice.outstandingAmount.toString()).toFixed(2)).toBe(
      expectedOutstanding.toFixed(2),
    );
  });

  // ─── CN-DB-08: original invoice totalAmount is NOT changed ───────────────────

  it('CN-DB-08: original invoice.totalAmount is not changed by posting a credit note', async () => {
    const invoiceId = await makePostedInvoice();

    const cn = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'CORRECTION',
      netAmount: '10000.00',
      accountingDate: '2026-09-17',
    });

    await service.postCreditNote(identity, {
      creditNoteId: cn.id,
      arAccountCode: env.accounts.arCode,
      revenueAccountCode: env.accounts.revCode,
      vatAccountCode,
    });

    const invoice = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { totalAmount: true },
    });

    expect(new Decimal(invoice.totalAmount.toString()).toFixed(2)).toBe(TOTAL);
  });

  // ─── CN-DB-09: credit > outstanding → CREDIT_EXCEEDS_OUTSTANDING ─────────────

  it('CN-DB-09: createCreditNote with amount > outstanding throws CREDIT_EXCEEDS_OUTSTANDING', async () => {
    // Invoice with very low outstanding (just enough to test the limit)
    const invoiceId = await makePostedInvoice('500.00');

    const err = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'OMISSION',
      netAmount: '1000.00', // 1000 + 50 = 1050 > 500
      accountingDate: '2026-09-17',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      code: 'CREDIT_EXCEEDS_OUTSTANDING',
    });
  });

  // ─── CN-DB-10: duplicate post → ConflictException ────────────────────────────

  it('CN-DB-10: posting an already-posted credit note throws ConflictException', async () => {
    const invoiceId = await makePostedInvoice();

    const cn = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'PRICE_ERROR',
      netAmount: '1000.00',
      accountingDate: '2026-09-17',
    });

    await service.postCreditNote(identity, {
      creditNoteId: cn.id,
      arAccountCode: env.accounts.arCode,
      revenueAccountCode: env.accounts.revCode,
      vatAccountCode,
    });

    await expect(
      service.postCreditNote(identity, {
        creditNoteId: cn.id,
        arAccountCode: env.accounts.arCode,
        revenueAccountCode: env.accounts.revCode,
        vatAccountCode,
      }),
    ).rejects.toThrow(ConflictException);
  });

  // ─── CN-DB-11: CN against NOT_POSTED invoice → BadRequestException ───────────

  it('CN-DB-11: createCreditNote against a NOT_POSTED invoice throws BadRequestException', async () => {
    const invoiceId = await makeNotPostedInvoice();

    await expect(
      service.createCreditNote(identity, {
        invoiceId,
        reason: 'OMISSION',
        netAmount: '1000.00',
        accountingDate: '2026-09-17',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // ─── CN-DB-12: OPEN accounting period → post succeeds ────────────────────────

  it('CN-DB-12: accountingDate in an OPEN period → post succeeds', async () => {
    const invoiceId = await makePostedInvoice();

    const cn = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'CORRECTION',
      netAmount: '500.00',
      accountingDate: '2025-01-15', // fixture OPEN period: 2025-01-01 to 2025-01-31
    });

    const posted = await service.postCreditNote(identity, {
      creditNoteId: cn.id,
      arAccountCode: env.accounts.arCode,
      revenueAccountCode: env.accounts.revCode,
      vatAccountCode,
    });

    expect(posted.postingStatus).toBe('POSTED');
  });

  // ─── CN-DB-13: LOCKED accounting period → post rejected ──────────────────────

  it('CN-DB-13: accountingDate in a LOCKED period → post rejected (ACCOUNTS_RECEIVABLE not allowed in LOCKED)', async () => {
    const invoiceId = await makePostedInvoice();

    const cn = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'CORRECTION',
      netAmount: '500.00',
      accountingDate: '2025-02-15', // fixture LOCKED period: 2025-02-01 to 2025-02-28
    });

    await expect(
      service.postCreditNote(identity, {
        creditNoteId: cn.id,
        arAccountCode: env.accounts.arCode,
        revenueAccountCode: env.accounts.revCode,
        vatAccountCode,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // ─── CN-DB-14: CLOSED accounting period → post rejected ──────────────────────

  it('CN-DB-14: accountingDate in a CLOSED period → post rejected', async () => {
    const invoiceId = await makePostedInvoice();

    const cn = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'CORRECTION',
      netAmount: '500.00',
      accountingDate: '2025-03-15', // fixture CLOSED period: 2025-03-01 to 2025-03-31
    });

    await expect(
      service.postCreditNote(identity, {
        creditNoteId: cn.id,
        arAccountCode: env.accounts.arCode,
        revenueAccountCode: env.accounts.revCode,
        vatAccountCode,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // ─── CN-DB-15/16: negative variation exact-once protection ───────────────────

  it('CN-DB-15: first credit note against a negative variation succeeds', async () => {
    // Seed a negative variation: VO total = -5,000 ex-tax
    const variation = await prisma.variationOrder.create({
      data: {
        organizationId: env.orgId,
        contractId,
        reference: 'VO-NEG-001',
        status: 'CLIENT_APPROVED',
        title: 'Negative variation for CN exact-once test',
        createdBy: identity.userId,
        lines: {
          create: [{
            description: 'Omission',
            quantity: new Decimal('1'),
            unitRate: new Decimal('-5000'),
            amount: new Decimal('-5000'),
          }],
        },
      },
      select: { id: true },
    });

    const invoiceId = await makePostedInvoice();

    // First CN: 4,000 ex-tax → 4,200 inc VAT — within the variation's -5,000 limit
    const cn = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'NEGATIVE_VARIATION',
      netAmount: '4000.00',
      accountingDate: '2026-09-17',
      sourceVariationId: variation.id,
    });

    expect(cn.postingStatus).toBe('NOT_POSTED');
    expect(new Decimal(cn.netAmount.toString()).toFixed(2)).toBe('4000.00');
  });

  it('CN-DB-16: second credit note against the same negative variation that exceeds remaining value → rejected', async () => {
    // Seed a fresh negative variation: total = -5,000
    const variation = await prisma.variationOrder.create({
      data: {
        organizationId: env.orgId,
        contractId,
        reference: 'VO-NEG-002',
        status: 'CLIENT_APPROVED',
        title: 'Negative variation exact-once second attempt test',
        createdBy: identity.userId,
        lines: {
          create: [{
            description: 'Omission',
            quantity: new Decimal('1'),
            unitRate: new Decimal('-5000'),
            amount: new Decimal('-5000'),
          }],
        },
      },
      select: { id: true },
    });

    const invoiceId = await makePostedInvoice();

    // First CN: 4,000 net → 4,200 total (uses 4,200 of 5,250 variation limit incl 5% VAT)
    await service.createCreditNote(identity, {
      invoiceId,
      reason: 'NEGATIVE_VARIATION',
      netAmount: '4000.00',
      accountingDate: '2026-09-17',
      sourceVariationId: variation.id,
    });

    // Second CN: 2,000 net → 2,100 total; 4,200 + 2,100 = 6,300 > 5,250 → rejected
    const err = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'NEGATIVE_VARIATION',
      netAmount: '2000.00',
      accountingDate: '2026-09-17',
      sourceVariationId: variation.id,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
  });

  // ─── CN-DB-17: zero-VAT invoice → credit note vatAmount = 0 ──────────────────

  it('CN-DB-17: credit note derives tax basis from original invoice — zero-VAT invoice produces zero-VAT credit note', async () => {
    // Invoice with zero VAT (subtotal 100,000 / vatAmount 0 / total 100,000)
    const zeroVatInvoice = await prisma.clientInvoice.create({
      data: {
        organizationId: env.orgId,
        clientId: env.clientId,
        projectId,
        contractId,
        invoiceDate: new Date('2026-09-01'),
        dueDate: new Date('2026-10-31'),
        subtotal: new Decimal('100000.00'),
        vatAmount: new Decimal('0.00'),
        totalAmount: new Decimal('100000.00'),
        outstandingAmount: new Decimal('100000.00'),
        currencyCode: 'USD',
        billingAddressSnapshot: {},
        postingStatus: 'POSTED',
        documentStatus: 'APPROVED',
        createdBy: identity.userId,
      },
      select: { id: true },
    });

    const cn = await service.createCreditNote(identity, {
      invoiceId: zeroVatInvoice.id,
      reason: 'CORRECTION',
      netAmount: '10000.00',
      accountingDate: '2026-09-17',
    });

    expect(new Decimal(cn.vatAmount.toString()).toFixed(2)).toBe('0.00');
    expect(new Decimal(cn.totalAmount.toString()).toFixed(2)).toBe('10000.00');
  });

  // ─── CN-DB-18: tax basis proof — 5% rate invoice → 500 VAT on 10k net ────────

  it('CN-DB-18: standard 5% invoice: credit note derives 500 VAT on net 10,000', async () => {
    const invoiceId = await makePostedInvoice(); // net 100,000 / vat 5,000 → rate = 0.05

    const cn = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'PRICE_ERROR',
      netAmount: '10000.00',
      accountingDate: '2026-09-17',
    });

    expect(new Decimal(cn.netAmount.toString()).toFixed(2)).toBe('10000.00');
    expect(new Decimal(cn.vatAmount.toString()).toFixed(2)).toBe('500.00');
    expect(new Decimal(cn.totalAmount.toString()).toFixed(2)).toBe('10500.00');
  });

  // ─── CN-DB-19/20/21: post-time race-condition protection ─────────────────────
  //
  // These three tests prove that postCreditNote() re-validates inside the
  // transaction after locking the invoice row, not just at createCreditNote().
  // The create-time check is a fast-fail convenience; the post-time check is the
  // financial invariant.

  it('CN-DB-19: payment reduces outstanding between create and post → post rejected', async () => {
    // Invoice: subtotal 100,000 / vat 5,000 / total 105,000 / outstanding 105,000
    const invoiceId = await makePostedInvoice();

    // Create CN using full outstanding — passes create-time check (0 + 105,000 ≤ 105,000)
    const cn = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'OMISSION',
      netAmount: '100000.00',
      accountingDate: '2026-09-17',
    });
    expect(cn.postingStatus).toBe('NOT_POSTED');

    // Simulate a 5,000 payment arriving between create and post
    await prisma.clientInvoice.update({
      where: { id: invoiceId },
      data: { outstandingAmount: new Decimal('100000.00') },
    });

    // Post should be rejected: CN total 105,000 > current outstanding 100,000
    const err = await service.postCreditNote(identity, {
      creditNoteId: cn.id,
      arAccountCode: env.accounts.arCode,
      revenueAccountCode: env.accounts.revCode,
      vatAccountCode,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      code: 'CREDIT_EXCEEDS_OUTSTANDING',
    });

    // Outstanding must remain at 100,000 — no partial decrement
    const invoice = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { outstandingAmount: true },
    });
    expect(new Decimal(invoice.outstandingAmount.toString()).toFixed(2)).toBe('100000.00');

    // No journal entry was created for this CN
    const rejectedCn = await prisma.creditNote.findUniqueOrThrow({ where: { id: cn.id } });
    expect(rejectedCn.postedJournalEntryId).toBeNull();
    expect(rejectedCn.postingStatus).toBe('NOT_POSTED');
  });

  it('CN-DB-20: first post depletes outstanding → second post rejected', async () => {
    // Invoice: outstanding 105,000
    const invoiceId = await makePostedInvoice();

    // CN-A created via service — passes create-time check (0 + 105,000 ≤ 105,000)
    const cnA = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'CORRECTION',
      netAmount: '100000.00',
      accountingDate: '2026-09-17',
    });

    // CN-B inserted directly — simulates a concurrent request that bypassed the
    // sequential create-time check (both requests saw outstanding = 105,000)
    const cnB = await prisma.creditNote.create({
      data: {
        organizationId: env.orgId,
        invoiceId,
        reason: 'CORRECTION',
        netAmount: new Decimal('100000.00'),
        vatAmount: new Decimal('5000.00'),
        totalAmount: new Decimal('105000.00'),
        accountingDate: new Date('2026-09-17'),
        postingStatus: 'NOT_POSTED',
        createdBy: identity.userId,
      },
      select: { id: true },
    });

    // Post CN-A → succeeds; outstanding → 0
    await service.postCreditNote(identity, {
      creditNoteId: cnA.id,
      arAccountCode: env.accounts.arCode,
      revenueAccountCode: env.accounts.revCode,
      vatAccountCode,
    });

    const afterA = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { outstandingAmount: true },
    });
    expect(new Decimal(afterA.outstandingAmount.toString()).toFixed(2)).toBe('0.00');

    // Post CN-B → rejected: CN total 105,000 > current outstanding 0
    const err = await service.postCreditNote(identity, {
      creditNoteId: cnB.id,
      arAccountCode: env.accounts.arCode,
      revenueAccountCode: env.accounts.revCode,
      vatAccountCode,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      code: 'CREDIT_EXCEEDS_OUTSTANDING',
    });

    // Outstanding remains 0 — CN-B did not further decrement it
    const afterB = await prisma.clientInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { outstandingAmount: true },
    });
    expect(new Decimal(afterB.outstandingAmount.toString()).toFixed(2)).toBe('0.00');
  });

  it('CN-DB-21: two CNs against same negative variation — first posts, second rejected by variation cap', async () => {
    // Negative variation: net = -5,000; cap incl. 5% VAT = 5,250
    const variation = await prisma.variationOrder.create({
      data: {
        organizationId: env.orgId,
        contractId,
        reference: 'VO-NEG-RACE-001',
        status: 'CLIENT_APPROVED',
        title: 'Race condition variation cap test',
        createdBy: identity.userId,
        lines: {
          create: [{
            description: 'Omission',
            quantity: new Decimal('1'),
            unitRate: new Decimal('-5000'),
            amount: new Decimal('-5000'),
          }],
        },
      },
      select: { id: true },
    });

    const invoiceId = await makePostedInvoice(); // outstanding 105,000

    // CN-A created via service: net 5,000, total 5,250 → 0 + 5,250 ≤ 5,250 ✓
    const cnA = await service.createCreditNote(identity, {
      invoiceId,
      reason: 'NEGATIVE_VARIATION',
      netAmount: '5000.00',
      accountingDate: '2026-09-17',
      sourceVariationId: variation.id,
    });

    // CN-B inserted directly — simulates the concurrent request that saw 0 existing
    const cnB = await prisma.creditNote.create({
      data: {
        organizationId: env.orgId,
        invoiceId,
        reason: 'NEGATIVE_VARIATION',
        netAmount: new Decimal('5000.00'),
        vatAmount: new Decimal('250.00'),
        totalAmount: new Decimal('5250.00'),
        accountingDate: new Date('2026-09-17'),
        postingStatus: 'NOT_POSTED',
        sourceVariationId: variation.id,
        createdBy: identity.userId,
      },
      select: { id: true },
    });

    // Post CN-A → passes both outstanding check and variation cap check → POSTED
    await service.postCreditNote(identity, {
      creditNoteId: cnA.id,
      arAccountCode: env.accounts.arCode,
      revenueAccountCode: env.accounts.revCode,
      vatAccountCode,
    });

    // Post CN-B:
    // - outstanding check passes (105,000 - 5,250 = 99,750; 5,250 ≤ 99,750)
    // - variation cap check REJECTED (POSTED = 5,250; 5,250 + 5,250 = 10,500 > 5,250)
    const err = await service.postCreditNote(identity, {
      creditNoteId: cnB.id,
      arAccountCode: env.accounts.arCode,
      revenueAccountCode: env.accounts.revCode,
      vatAccountCode,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);

    // CN-B must not be posted
    const cnBRow = await prisma.creditNote.findUniqueOrThrow({ where: { id: cnB.id } });
    expect(cnBRow.postingStatus).toBe('NOT_POSTED');
    expect(cnBRow.postedJournalEntryId).toBeNull();
  });
});
